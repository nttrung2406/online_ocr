import { MODELS, defaultModelId } from '../config.js';
import { EngineModel } from '../models/EngineModel.js';
import { detectCapabilities } from '../services/capabilities.js';
import { toast } from '../views/dom.js';

/** `?n_ctx=…&n_batch=…&n_ubatch=…&image_max_tokens=…` tweak memory use without a rebuild. */
function runtimeOverrides() {
  const q = new URLSearchParams(location.search);
  const keys = ['n_ctx', 'n_batch', 'n_ubatch', 'image_max_tokens', 'image_min_tokens'];
  return Object.fromEntries(keys.filter((k) => q.has(k)).map((k) => [k, Number(q.get(k))]));
}

const VISION_CPU_KEY = 'online-ocr:vision-on-cpu';

/** Image encoder placement: `?vision=cpu|gpu` wins, else what this device needed last time. */
function visionOnCpuPreference() {
  const q = new URLSearchParams(location.search).get('vision');
  if (q) return q === 'cpu';
  try {
    return localStorage.getItem(VISION_CPU_KEY) === '1';
  } catch {
    return false;
  }
}

function rememberVisionOnCpu() {
  try {
    localStorage.setItem(VISION_CPU_KEY, '1');
  } catch {
    /* ignore */
  }
}

/** Owns the model lifecycle: capability check → pick variant → download → load → ready. */
export class EngineController {
  #abort = null;

  constructor({ model, view, engine }) {
    this.model = model;
    this.view = view;
    this.engine = engine;

    model.on('change', (s) => view.render(s));
    view.bindPrimary((action) => {
      if (action === 'download') this.download();
      else if (action === 'load') this.load();
    });
    view.bindCancel(() => this.#abort?.abort());
    view.bindDelete(() => this.deleteModel());
    view.bindVariant((id) => this.selectVariant(id));
  }

  get #variant() {
    return MODELS[this.model.state.variantId];
  }

  async init() {
    this.view.render(this.model.state);
    const capabilities = await detectCapabilities();
    const recommendedId = defaultModelId(capabilities);
    const saved = EngineModel.loadSavedVariant();
    const variantId = MODELS[saved] ? saved : recommendedId;
    this.model.update({ capabilities, recommendedId, variantId });
    if (!capabilities.supported) return this.model.update({ status: 'unsupported' });
    await this.#refreshCache();
  }

  async #refreshCache() {
    try {
      const entries = await Promise.all(Object.values(MODELS).map(async (v) => [v.id, await this.engine.cachedSize(v)]));
      const cached = Object.fromEntries(entries);
      this.model.update({ cached, status: cached[this.model.state.variantId] ? 'cached' : 'absent' });
    } catch (err) {
      this.model.update({ status: 'absent', error: `Could not read browser storage: ${err.message}` });
    }
  }

  async selectVariant(id) {
    const { status, variantId } = this.model.state;
    if (!MODELS[id] || id === variantId || status === 'downloading' || status === 'loading') return;
    EngineModel.saveVariant(id);
    await this.engine.unload();
    this.model.update({ variantId: id, backend: null, error: null });
    await this.#refreshCache();
  }

  async download() {
    this.#abort = new AbortController();
    this.model.update({ status: 'downloading', error: null, progress: { loaded: 0, total: 0, bytesPerSec: 0 } });

    let last = { t: performance.now(), loaded: 0 };
    let rate = 0;
    try {
      await this.engine.download(this.#variant, {
        signal: this.#abort.signal,
        onProgress: (loaded, total) => {
          const now = performance.now();
          const dt = (now - last.t) / 1000;
          if (dt >= 0.5) {
            const inst = (loaded - last.loaded) / dt;
            rate = rate ? rate * 0.7 + inst * 0.3 : inst; // smoothed speed
            last = { t: now, loaded };
          }
          this.model.update({ progress: { loaded, total, bytesPerSec: rate } });
        },
      });
    } catch (err) {
      const aborted = this.#abort.signal.aborted;
      await this.#refreshCache();
      if (!aborted) this.model.update({ error: `Download failed: ${err.message}` });
      else toast('Download cancelled');
      return;
    } finally {
      this.#abort = null;
    }

    await this.#refreshCache();
    toast('Model downloaded and cached for offline use');
    await this.load();
  }

  async load() {
    this.model.update({ status: 'loading', error: null });
    try {
      // `?backend=webgpu|cpu` overrides auto-detection (troubleshooting / testing).
      const forced = new URLSearchParams(location.search).get('backend');
      const preferGpu = forced ? forced === 'webgpu' : !!this.model.state.capabilities?.webgpu;
      const { backend, threads, visionOnCpu } = await this.engine.load(this.#variant, {
        preferGpu,
        overrides: runtimeOverrides(),
        visionOnCpu: visionOnCpuPreference(),
      });
      this.model.update({ status: 'ready', backend, threads, visionOnCpu });
      const where = backend === 'webgpu' ? 'WebGPU' : `CPU (${threads} threads)`;
      toast(`Model ready on ${where}`);
    } catch (err) {
      const hint = err.code === 'cpu_heap_limit' ? '' : ' This usually means the device ran out of memory — close other tabs and retry.';
      this.model.update({ status: 'error', error: `Could not load the model: ${err.message}${hint}` });
    }
  }

  /**
   * Reload after the engine crashed mid-OCR. If WebGPU timed out while encoding the image,
   * move the image encoder to CPU first (remembered for this device).
   * @returns {Promise<boolean>} true when the engine is ready again
   */
  async recover(crash) {
    const { backend, visionOnCpu } = this.model.state;
    if (crash?.gpuTimeout && backend === 'webgpu' && !visionOnCpu) {
      rememberVisionOnCpu();
      toast('The GPU timed out encoding the image — moving that step to the CPU and retrying.', 5000);
      this.view.appendLog('warn', 'WebGPU image-encoding timeout: reloading with the vision encoder on CPU.');
    } else {
      toast('The OCR engine crashed — reloading and retrying.', 4000);
    }
    this.model.update({ status: 'cached', backend: null });
    await this.load();
    return this.model.isReady;
  }

  async deleteModel() {
    if (!confirm(`Delete the cached ${this.#variant.quant} model from this browser? You will need to download it again to use OCR.`)) return;
    await this.engine.deleteCache(this.#variant);
    this.model.update({ backend: null, error: null });
    await this.#refreshCache();
    toast('Cached model deleted');
  }
}
