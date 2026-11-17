import { $ } from './dom.js';

export class UploadView {
  constructor() {
    this.dropzone = $('#dropzone');
    this.input = $('#file-input');
    this.status = $('#upload-status');
    this.runBtn = $('#run-btn');
    this.stopBtn = $('#stop-btn');
    this.clearBtn = $('#clear-btn');
    this.hint = $('#run-hint');
  }

  /** Files from picker, drag & drop, or clipboard paste all funnel into one handler. */
  bindFiles(handler) {
    this.input.addEventListener('change', () => {
      if (this.input.files.length) handler([...this.input.files]);
      this.input.value = '';
    });

    const stop = (e) => {
      e.preventDefault();
      e.stopPropagation();
    };
    ['dragenter', 'dragover'].forEach((t) =>
      this.dropzone.addEventListener(t, (e) => {
        stop(e);
        this.dropzone.classList.add('dragover');
      }),
    );
    ['dragleave', 'drop'].forEach((t) =>
      this.dropzone.addEventListener(t, (e) => {
        stop(e);
        this.dropzone.classList.remove('dragover');
      }),
    );
    this.dropzone.addEventListener('drop', (e) => {
      const files = [...(e.dataTransfer?.files ?? [])];
      if (files.length) handler(files);
    });
    // Dropping outside the zone shouldn't navigate away from the app.
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', (e) => e.preventDefault());

    document.addEventListener('paste', (e) => {
      const files = [...(e.clipboardData?.items ?? [])]
        .filter((it) => it.kind === 'file')
        .map((it, i) => {
          const f = it.getAsFile();
          if (!f) return null;
          const ext = (f.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
          return f.name && f.name !== 'image.png' ? f : new File([f], `pasted-${Date.now()}-${i}.${ext}`, { type: f.type });
        })
        .filter(Boolean);
      if (files.length) {
        e.preventDefault();
        handler(files);
      }
    });

    this.dropzone.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this.input.click();
      }
    });
  }

  bindRun(h) {
    this.runBtn.addEventListener('click', h);
  }
  bindStop(h) {
    this.stopBtn.addEventListener('click', h);
  }
  bindClear(h) {
    this.clearBtn.addEventListener('click', h);
  }

  setStatus(text) {
    this.status.textContent = text;
  }

  render({ pendingCount, totalCount, running, engineReady, importing }) {
    this.runBtn.hidden = running;
    this.stopBtn.hidden = !running;
    this.runBtn.disabled = !engineReady || pendingCount === 0 || importing;
    this.runBtn.textContent = pendingCount > 1 ? `Run OCR (${pendingCount} pages)` : 'Run OCR';
    this.clearBtn.disabled = totalCount === 0 || running;
    this.hint.textContent =
      !engineReady && pendingCount > 0 ? 'Load the model to start OCR.' : running ? 'OCR in progress — results stream in as they are generated.' : '';
  }
}
