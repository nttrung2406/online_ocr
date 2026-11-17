import { processFile, detectKind } from '../services/DocumentProcessor.js';
import { cleanModelOutput, htmlToMarkdown, htmlToText, sanitizeHtml } from '../services/outputFormat.js';
import { toast, copyText, downloadText } from '../views/dom.js';

// Only a user cancel counts: native crashes also mention "ABORT" and must not be treated as one.
const isAbort = (err) => err?.name === 'AbortError' || err?.name === 'WllamaAbortError';
const MAX_CRASH_RETRIES = 1;

/** Owns documents: import → page queue → sequential OCR → export. */
export class DocumentController {
  #running = false;
  #importing = 0;
  #abort = null;

  /** @param {{ recoverEngine: (crash: Error) => Promise<boolean> }} deps also: docs, engineModel, engine, views */
  constructor({ docs, engineModel, engine, uploadView, pagesView, recoverEngine }) {
    Object.assign(this, { docs, engineModel, engine, uploadView, pagesView, recoverEngine });

    docs.on('pages', (pages) => {
      pagesView.renderList(pages);
      this.#syncControls();
    });
    docs.on('page', (page) => {
      pagesView.renderPage(page);
      pagesView.setExportEnabled(docs.completed().length > 0);
      this.#syncControls();
    });
    engineModel.on('change', () => this.#syncControls());

    uploadView.bindFiles((files) => this.addFiles(files));
    uploadView.bindRun(() => this.run());
    uploadView.bindStop(() => this.#abort?.abort());
    uploadView.bindClear(() => this.docs.clear());
    pagesView.bind({
      onRetry: (id) => this.retry(id),
      onRemove: (id) => this.docs.removePage(id),
      onCopy: (id, tab) => this.copyPage(id, tab),
      onExport: (kind) => this.export(kind),
    });
    this.#syncControls();
  }

  #syncControls() {
    this.uploadView.render({
      pendingCount: this.docs.pending().length,
      totalCount: this.docs.pages.length,
      running: this.#running,
      engineReady: this.engineModel.isReady,
      importing: this.#importing > 0,
    });
  }

  async addFiles(files) {
    const supported = files.filter((f) => detectKind(f));
    const rejected = files.length - supported.length;
    if (rejected) toast(`${rejected} file(s) skipped — only PDF, DOCX and images are supported`);
    if (!supported.length) return;

    this.#importing++;
    this.#syncControls();
    try {
      for (const file of supported) {
        this.uploadView.setStatus(`Preparing ${file.name}…`);
        try {
          let count = 0;
          for await (const page of processFile(file)) {
            const previewUrl = page.blob ? URL.createObjectURL(page.blob) : null;
            this.docs.addPages([{ ...page, sourceName: file.name, previewUrl }]);
            this.uploadView.setStatus(`Preparing ${file.name}… ${++count} page(s)`);
          }
        } catch (err) {
          toast(`Could not read ${file.name}: ${err.message}`, 5000);
        }
      }
      const n = this.docs.pending().length;
      this.uploadView.setStatus(n ? `${n} page(s) ready for OCR.` : '');
    } finally {
      this.#importing--;
      this.#syncControls();
    }
    if (this.engineModel.isReady && !this.#running) this.run();
  }

  retry(id) {
    this.docs.updatePage(id, { status: 'pending', error: null, html: '', stats: null });
    if (this.engineModel.isReady && !this.#running) this.run();
  }

  async run() {
    if (this.#running || !this.engineModel.isReady) return;
    this.#running = true;
    this.#abort = new AbortController();
    this.#syncControls();
    const signal = this.#abort.signal;

    try {
      let page;
      while (!signal.aborted && this.engineModel.isReady && (page = this.docs.pending()[0])) {
        await this.#recognize(page, signal);
      }
    } finally {
      this.#running = false;
      this.#abort = null;
      this.#syncControls();
      const done = this.docs.completed().length;
      this.uploadView.setStatus(signal.aborted ? 'Stopped.' : done ? `Finished — ${done} page(s) recognized.` : '');
    }
  }

  async #recognize(page, signal) {
    const id = page.id;
    this.docs.updatePage(id, { status: 'running', html: '', error: null, stats: null });
    this.uploadView.setStatus(`Recognizing ${page.sourceName} · ${page.label}…`);

    // Coalesce streamed tokens into at most one re-render per animation frame.
    let latest = '';
    let scheduled = false;
    const flush = () => {
      scheduled = false;
      if (this.docs.get(id)?.status === 'running') this.docs.updatePage(id, { html: cleanModelOutput(latest) });
    };

    try {
      const data = await page.blob.arrayBuffer();
      const res = await this.engine.recognize(data, {
        signal,
        onToken: (text) => {
          latest = text;
          if (!scheduled) {
            scheduled = true;
            requestAnimationFrame(flush);
          }
        },
      });
      this.docs.updatePage(id, {
        status: 'done',
        html: cleanModelOutput(res.text),
        stats: { tokens: res.tokens, ms: res.ms, truncated: res.finishReason === 'length' },
      });
    } catch (err) {
      if (isAbort(err) || signal.aborted) this.docs.updatePage(id, { status: 'pending', html: '' });
      else if (err?.code === 'engine_crashed') await this.#handleCrash(page, err);
      else this.docs.updatePage(id, { status: 'error', error: err?.message ?? String(err) });
    }
  }

  /** Reload the engine and requeue the page once; give up on pages that keep crashing it. */
  async #handleCrash(page, err) {
    const crashes = (page.crashes ?? 0) + 1;
    if (crashes > MAX_CRASH_RETRIES) {
      this.docs.updatePage(page.id, {
        status: 'error',
        crashes,
        error: `${err.message} The engine crashed again after reloading. Try the CPU-compatible model variant.`,
      });
    } else {
      this.docs.updatePage(page.id, { status: 'pending', html: '', crashes });
    }
    this.uploadView.setStatus('Reloading the OCR engine…');
    const ok = await this.recoverEngine(err);
    if (!ok) this.uploadView.setStatus('The OCR engine could not be reloaded — see the Model panel.');
  }

  #render(page, format) {
    if (format === 'Markdown' || format === 'md') return htmlToMarkdown(page.html);
    if (format === 'Text') return htmlToText(page.html);
    return page.html;
  }

  copyPage(id, tab) {
    const page = this.docs.get(id);
    if (page?.html) copyText(this.#render(page, tab === 'Preview' ? 'Markdown' : tab));
  }

  export(kind) {
    const pages = this.docs.completed();
    if (!pages.length) return;
    const base = (pages[0].sourceName || 'ocr').replace(/\.[^.]+$/, '') + (new Set(pages.map((p) => p.sourceName)).size > 1 ? '-and-more' : '');

    if (kind === 'md' || kind === 'copy-md') {
      const md = pages.map((p) => `<!-- ${p.sourceName} · ${p.label} -->\n\n${htmlToMarkdown(p.html)}`).join('\n\n---\n\n');
      if (kind === 'copy-md') copyText(md);
      else downloadText(`${base}.md`, md, 'text/markdown');
    } else if (kind === 'html') {
      const body = pages
        .map((p) => `<section>\n<h6 class="src">${escapeHtml(p.sourceName)} · ${escapeHtml(p.label)}</h6>\n${sanitizeHtml(p.html)}\n</section>`)
        .join('\n<hr>\n');
      const doc = `<!doctype html>\n<html><head><meta charset="utf-8"><title>${escapeHtml(base)}</title>
<style>body{font:16px/1.55 system-ui,sans-serif;max-width:860px;margin:2rem auto;padding:0 1rem}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:4px 8px}.src{color:#888;font-weight:400}</style>
</head><body>\n${body}\n</body></html>`;
      downloadText(`${base}.html`, doc, 'text/html');
    }
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
