import { EventEmitter } from '../core/EventEmitter.js';

const VARIANT_KEY = 'online-ocr:model-variant';

/**
 * State of the OCR engine (model files + runtime).
 * status: 'checking' | 'unsupported' | 'absent' | 'downloading' | 'cached' | 'loading' | 'ready' | 'error'
 */
export class EngineModel extends EventEmitter {
  state = {
    status: 'checking',
    variantId: null, // key of config.MODELS
    recommendedId: null,
    cached: {}, // variantId → bytes cached (0 = not downloaded)
    progress: { loaded: 0, total: 0, bytesPerSec: 0 },
    backend: null, // 'webgpu' | 'cpu'
    visionOnCpu: false, // image encoder (mmproj) running on CPU while the LLM uses WebGPU
    threads: 1,
    error: null,
    capabilities: null,
  };

  update(patch) {
    this.state = { ...this.state, ...patch };
    this.emit('change', this.state);
  }

  get isReady() {
    return this.state.status === 'ready';
  }

  /** The user's explicit variant choice, or null for "auto". */
  static loadSavedVariant() {
    try {
      return localStorage.getItem(VARIANT_KEY);
    } catch {
      return null;
    }
  }

  static saveVariant(id) {
    try {
      localStorage.setItem(VARIANT_KEY, id);
    } catch {
      /* ignore */
    }
  }
}
