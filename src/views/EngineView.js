import { $, h } from './dom.js';
import { MODELS, MODEL_NAME } from '../config.js';
import { formatBytes, formatDuration } from '../services/outputFormat.js';

const STATUS = {
  checking: ['Checking…', null],
  unsupported: ['Unsupported', 'danger'],
  absent: ['Not downloaded', null],
  downloading: ['Downloading', 'accent'],
  cached: ['Downloaded', 'accent'],
  loading: ['Loading', 'accent'],
  ready: ['Ready', 'ok'],
  error: ['Error', 'danger'],
};

const MAX_LOG_LINES = 300;

export class EngineView {
  constructor() {
    this.status = $('#engine-status');
    this.desc = $('#engine-desc');
    this.caps = $('#engine-caps');
    this.warnings = $('#engine-warnings');
    this.progress = $('#engine-progress');
    this.progressBar = $('#engine-progress .progress-bar');
    this.progressFill = $('#engine-progress-fill');
    this.progressText = $('#engine-progress-text');
    this.primary = $('#engine-primary');
    this.cancel = $('#engine-cancel');
    this.del = $('#engine-delete');
    this.log = $('#engine-log');
    this.variant = $('#engine-variant');
  }

  bindPrimary(handler) {
    this.primary.addEventListener('click', () => handler(this.primary.dataset.action));
  }
  bindCancel(handler) {
    this.cancel.addEventListener('click', handler);
  }
  bindDelete(handler) {
    this.del.addEventListener('click', handler);
  }
  bindVariant(handler) {
    this.variant.addEventListener('change', () => handler(this.variant.value));
  }

  appendLog(level, text) {
    const line = `[${new Date().toLocaleTimeString()}] ${level === 'log' ? '' : level.toUpperCase() + ' '}${text}\n`;
    this.log.append(line);
    while (this.log.childNodes.length > MAX_LOG_LINES) this.log.firstChild.remove();
    this.log.scrollTop = this.log.scrollHeight;
  }

  render(state) {
    this.#renderVariant(state);
    this.#renderStatus(state);
    if (state.capabilities) this.#renderCapabilities(state.capabilities, state.error);
    this.#renderProgress(state.status, state.progress);
    this.#renderButtons(state);
  }

  #renderVariant({ variantId, recommendedId, cached, status }) {
    const variant = MODELS[variantId];
    this.variant.replaceChildren(
      ...Object.values(MODELS).map((v) => {
        const tags = [formatBytes(v.approxBytes), v.id === recommendedId && 'recommended here', cached[v.id] && 'downloaded'];
        return h('option', { value: v.id, selected: v.id === variantId }, `${v.label} — ${tags.filter(Boolean).join(', ')}`);
      }),
    );
    this.variant.disabled = !variantId || ['checking', 'unsupported', 'downloading', 'loading'].includes(status);
    this.desc.textContent = variant
      ? `${MODEL_NAME} ${variant.quant} GGUF + vision projector (~${formatBytes(variant.approxBytes)}). Downloaded once, then cached in browser storage for offline use.`
      : '';
  }

  #renderStatus({ status, backend, visionOnCpu }) {
    const [label, tone] = STATUS[status] ?? [status, null];
    let backendName = 'CPU';
    if (backend === 'webgpu') backendName = visionOnCpu ? 'WebGPU + CPU vision' : 'WebGPU';
    this.status.textContent = status === 'ready' && backend ? `Ready · ${backendName}` : label;
    if (tone) this.status.dataset.tone = tone;
    else delete this.status.dataset.tone;
  }

  #renderCapabilities(caps, error) {
    const chip = (on, text, title) => h('li', { class: 'chip', dataset: { on: String(on) }, title }, text);
    let gpuLabel = 'No WebGPU';
    if (caps.webgpu) gpuLabel = `WebGPU · ${caps.gpuName}`;
    else if (caps.softwareGpu) gpuLabel = 'Software GPU only';
    const freeBytes = caps.storageQuota == null ? null : caps.storageQuota - (caps.storageUsage ?? 0);

    this.caps.replaceChildren(
      chip(caps.webgpu, gpuLabel, 'GPU acceleration'),
      chip(caps.memory64, caps.memory64 ? 'WASM64' : 'No WASM64', '64-bit WebAssembly memory (needed for >4 GB)'),
      chip(caps.threads, caps.threads ? `${caps.cores} threads` : 'Single thread', 'Multi-threaded CPU inference'),
      freeBytes == null ? null : chip(true, `Storage ${formatBytes(freeBytes)} free`, 'Browser storage quota'),
    );
    const items = caps.warnings.map((w) => h('li', null, w));
    if (error) items.unshift(h('li', { class: 'error' }, error));
    this.warnings.replaceChildren(...items);
  }

  #renderProgress(status, progress) {
    this.progress.hidden = status !== 'downloading' && status !== 'loading';
    if (status === 'loading') {
      this.progressBar.classList.add('indeterminate');
      this.progressFill.style.width = '';
      this.progressText.textContent = 'Loading weights into memory and compiling GPU kernels — this can take a minute…';
      return;
    }
    if (status !== 'downloading') return;

    const { loaded, total, bytesPerSec } = progress;
    this.progressBar.classList.toggle('indeterminate', !total);
    if (!total) {
      this.progressText.textContent = 'Starting download…';
      return;
    }
    const pct = (loaded / total) * 100;
    const etaMs = bytesPerSec > 0 ? ((total - loaded) / bytesPerSec) * 1000 : Number.NaN;
    this.progressFill.style.width = `${pct.toFixed(1)}%`;
    this.progressText.textContent = [
      `${formatBytes(loaded)} / ${formatBytes(total)} (${pct.toFixed(1)}%)`,
      `${formatBytes(bytesPerSec)}/s`,
      `${formatDuration(etaMs)} left`,
    ].join(' · ');
  }

  #renderButtons({ status, variantId, cached }) {
    const cachedBytes = cached[variantId] ?? 0;
    const size = MODELS[variantId] ? formatBytes(MODELS[variantId].approxBytes) : '';
    const retryAction = cachedBytes ? 'load' : 'download';
    const [label, action, disabled] = {
      checking: ['Checking…', '', true],
      unsupported: ['Browser not supported', '', true],
      absent: [`Download model (${size})`, 'download', false],
      downloading: ['Downloading…', '', true],
      cached: ['Load model', 'load', false],
      loading: ['Loading…', '', true],
      ready: ['Model ready', '', true],
      error: [cachedBytes ? 'Retry loading' : 'Retry download', retryAction, false],
    }[status] ?? ['…', '', true];
    this.primary.textContent = label;
    this.primary.dataset.action = action;
    this.primary.disabled = disabled;
    this.cancel.hidden = status !== 'downloading';
    const busy = status === 'downloading' || status === 'loading';
    this.del.hidden = !cachedBytes || busy;
  }
}
