import { $, h } from './dom.js';
import { sanitizeHtml, htmlToMarkdown, htmlToText, formatDuration } from '../services/outputFormat.js';

const STATUS = {
  pending: ['Queued', null],
  running: ['Recognizing…', 'accent'],
  done: ['Done', 'ok'],
  error: ['Failed', 'danger'],
};
const TABS = ['Preview', 'HTML', 'Markdown', 'Text'];

export class PagesView {
  #cards = new Map(); // id → { root, refs, tab }
  #handlers = {};

  constructor() {
    this.container = $('#pages');
    this.empty = $('#pages-empty');
    this.exportButtons = [...document.querySelectorAll('[data-export]')];
  }

  bind(handlers) {
    this.#handlers = handlers; // { onRetry, onRemove, onCopy, onExport }
    this.exportButtons.forEach((b) => b.addEventListener('click', () => handlers.onExport(b.dataset.export)));
  }

  renderList(pages) {
    const ids = new Set(pages.map((p) => p.id));
    for (const [id, card] of this.#cards) {
      if (!ids.has(id)) {
        card.root.remove();
        this.#cards.delete(id);
      }
    }
    for (const page of pages) {
      if (!this.#cards.has(page.id)) this.container.append(this.#createCard(page));
      this.renderPage(page);
    }
    this.empty.hidden = pages.length > 0;
    this.setExportEnabled(pages.some((p) => p.status === 'done' && p.html));
  }

  setExportEnabled(on) {
    this.exportButtons.forEach((b) => (b.disabled = !on));
  }

  #createCard(page) {
    const refs = {};
    const thumb =
      page.kind === 'image'
        ? h('img', {
            src: page.previewUrl,
            alt: `${page.sourceName} — ${page.label}`,
            loading: 'lazy',
            onclick: () => this.#lightbox(page.previewUrl),
          })
        : h('div', { class: 'doc-icon' }, 'DOCX');

    refs.status = h('span', { class: 'pill' });
    refs.stats = h('span', { class: 'small muted' });
    refs.tabs = h(
      'div',
      { class: 'tabs', role: 'tablist' },
      TABS.map((t) =>
        h('button', { class: 'tab', role: 'tab', type: 'button', 'aria-selected': String(t === 'Preview'), onclick: () => this.#setTab(page.id, t) }, t),
      ),
    );
    refs.output = h('div', { class: 'output rendered', role: 'tabpanel' });
    refs.error = h('p', { class: 'error-text', hidden: true });
    refs.retry = h('button', { class: 'btn btn-sm', type: 'button', onclick: () => this.#handlers.onRetry(page.id) }, 'Retry');
    refs.copy = h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: () => this.#copy(page.id) }, 'Copy');
    refs.remove = h('button', { class: 'btn btn-sm btn-danger-ghost', type: 'button', onclick: () => this.#handlers.onRemove(page.id) }, 'Remove');

    const root = h(
      'article',
      { class: 'page', 'aria-label': `${page.sourceName} ${page.label}` },
      h('div', { class: 'page-thumb' }, thumb, refs.stats),
      h(
        'div',
        { class: 'page-body' },
        h(
          'div',
          { class: 'page-meta' },
          h('div', { class: 'page-title' }, h('strong', { title: page.sourceName }, page.sourceName), h('span', { class: 'small muted' }, page.label), refs.status),
          h('div', { class: 'actions' }, refs.retry, refs.copy, refs.remove),
        ),
        refs.tabs,
        refs.output,
        refs.error,
      ),
    );
    this.#cards.set(page.id, { root, refs, tab: 'Preview', page });
    return root;
  }

  #setTab(id, tab) {
    const card = this.#cards.get(id);
    if (!card) return;
    card.tab = tab;
    [...card.refs.tabs.children].forEach((b) => b.setAttribute('aria-selected', String(b.textContent === tab)));
    this.#renderOutput(card);
  }

  #renderOutput(card) {
    const { page, tab, refs } = card;
    const html = page.html || '';
    const out = refs.output;
    out.className = 'output';
    out.classList.toggle('streaming', page.status === 'running');
    if (!html) {
      out.replaceChildren(
        h('p', { class: 'muted small' }, page.status === 'running' ? 'Encoding image…' : page.status === 'pending' ? 'Waiting to run.' : 'No output.'),
      );
      return;
    }
    if (tab === 'Preview') {
      out.classList.add('rendered');
      out.innerHTML = sanitizeHtml(html);
    } else {
      out.classList.add('code');
      out.textContent = tab === 'HTML' ? html : tab === 'Markdown' ? htmlToMarkdown(html) : htmlToText(html);
    }
    if (page.status === 'running') out.scrollTop = out.scrollHeight;
  }

  renderPage(page) {
    const card = this.#cards.get(page.id);
    if (!card) return;
    card.page = page;
    const { refs } = card;
    const [label, tone] = page.kind === 'text' ? ['Extracted', 'ok'] : (STATUS[page.status] ?? [page.status, null]);
    refs.status.textContent = label;
    if (tone) refs.status.dataset.tone = tone;
    else delete refs.status.dataset.tone;

    const s = page.stats;
    refs.stats.textContent =
      page.kind === 'text'
        ? 'Text taken directly from the file (no OCR needed).'
        : [page.width && `${page.width}×${page.height}px`, s && `${s.tokens} tok · ${formatDuration(s.ms)} · ${(s.tokens / (s.ms / 1000)).toFixed(1)} tok/s`, s?.truncated && '⚠ hit token limit']
            .filter(Boolean)
            .join(' · ');

    refs.error.hidden = !page.error;
    refs.error.textContent = page.error ?? '';
    refs.retry.hidden = page.kind !== 'image' || page.status === 'running' || page.status === 'pending';
    refs.remove.disabled = page.status === 'running';
    refs.copy.disabled = !page.html;
    this.#renderOutput(card);
  }

  #copy(id) {
    const card = this.#cards.get(id);
    if (card) this.#handlers.onCopy(id, card.tab);
  }

  #lightbox(src) {
    const box = h('div', { class: 'lightbox', role: 'dialog', 'aria-label': 'Page preview', tabindex: '-1' }, h('img', { src, alt: '' }));
    const close = () => {
      box.remove();
      document.removeEventListener('keydown', onKey);
    };
    const onKey = (e) => e.key === 'Escape' && close();
    box.addEventListener('click', close);
    document.addEventListener('keydown', onKey);
    document.body.append(box);
    box.focus();
  }
}
