import { Wllama, ModelManager } from '@wllama/wllama';
import wasmUrl from '@wllama/wllama/esm/wasm/wllama.wasm?url';
import { OCR_PROMPT } from '../config.js';
import { ResumableCacheManager } from './ResumableCacheManager.js';

/**
 * Thin service around wllama (llama.cpp compiled to WebAssembly + WebGPU).
 * - Model files are cached in OPFS → later visits are fully local.
 * - Loading tries WebGPU first and falls back to CPU (WASM SIMD + threads) if that fails.
 * Every method takes a model variant from config.MODELS ({ url, mmprojUrl, runtime }).
 */
export class OcrEngine {
  #wllama = null;
  #variant = null;
  #manager;
  #onLog;

  constructor({ onLog = () => {} } = {}) {
    this.#onLog = onLog;
    this.#manager = new ModelManager({
      cacheManager: new ResumableCacheManager(),
      logger: this.#logger(),
      parallelDownloads: 2,
    });
  }

  #logger() {
    const fwd = (level) => (...args) => this.#onLog(level, args.map(String).join(' '));
    return { debug: () => {}, log: fwd('log'), warn: fwd('warn'), error: fwd('error') };
  }

  async #findCached(variant) {
    const models = await this.#manager.getModels();
    return models.find((m) => m.url === variant.url && m.mmprojUrl === variant.mmprojUrl) ?? null;
  }

  /** @returns {Promise<number>} cached size in bytes, or 0 when not (fully) cached */
  async cachedSize(variant) {
    const m = await this.#findCached(variant);
    return m?.validate() === 'valid' ? m.size : 0;
  }

  async download(variant, { onProgress, signal } = {}) {
    // Ask the browser not to evict multi-GB files under storage pressure.
    await navigator.storage?.persist?.().catch(() => {});
    return this.#manager.downloadModel(
      { url: variant.url, mmprojUrl: variant.mmprojUrl },
      { signal, progressCallback: ({ loaded, total }) => onProgress?.(loaded, total) },
    );
  }

  async deleteCache(variant) {
    await this.unload();
    const m = await this.#findCached(variant);
    if (m) await m.remove();
  }

  /**
   * Load a cached variant into the runtime.
   * @returns {Promise<{backend: 'webgpu'|'cpu', threads: number}>}
   */
  async load(variant, { preferGpu = true, overrides = {} } = {}) {
    const model = await this.#findCached(variant);
    if (!model) throw new Error('Model is not downloaded yet.');

    const tryLoad = async (gpu) => {
      await this.unload();
      this.#wllama = new Wllama({ default: wasmUrl }, { logger: this.#logger() });
      await this.#wllama.loadModel(model, {
        ...variant.runtime,
        ...overrides,
        n_parallel: 1,
        n_gpu_layers: gpu ? 99999 : 0,
        jinja: true,
        reasoning: false,
        warmup: false,
      });
      this.#variant = variant;
      return { backend: gpu ? 'webgpu' : 'cpu', threads: this.#wllama.getNumThreads() };
    };

    if (preferGpu && 'gpu' in navigator) {
      try {
        return await tryLoad(true);
      } catch (err) {
        this.#onLog('warn', `WebGPU load failed, falling back to CPU: ${err?.message ?? err}`);
      }
    }
    try {
      return await tryLoad(false);
    } catch (err) {
      await this.unload();
      // wllama's WASM heap is capped at 4 GiB; on CPU every weight must live inside it.
      const e = new Error(
        variant.id === 'gpu'
          ? 'CPU mode ran out of WebAssembly memory: the runtime heap is capped at 4 GiB and the Q4_K_M variant needs more. Switch to the CPU-compatible variant.'
          : 'CPU mode ran out of WebAssembly memory (4 GiB heap). Close other tabs and retry.',
      );
      e.cause = err;
      e.code = 'cpu_heap_limit';
      throw e;
    }
  }

  async unload() {
    if (!this.#wllama) return;
    try {
      await this.#wllama.exit();
    } catch {
      /* already gone */
    }
    this.#wllama = null;
  }

  get loaded() {
    return !!this.#wllama?.isModelLoaded();
  }

  /**
   * OCR one image. Streams partial HTML through onToken.
   * @param {ArrayBuffer} imageData encoded PNG/JPEG
   * @returns {Promise<{text: string, finishReason: string|null, tokens: number, ms: number}>}
   */
  async recognize(imageData, { onToken, signal } = {}) {
    if (!this.loaded) throw new Error('Model is not loaded.');
    const started = performance.now();
    let text = '';
    let finishReason = null;
    let tokens = 0;
    await this.#wllama.createChatCompletion({
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', data: imageData },
            { type: 'text', text: OCR_PROMPT },
          ],
        },
      ],
      stream: true,
      max_tokens: this.#variant.maxTokens,
      temperature: 0,
      top_k: 1,
      penalty_repeat: 1.05,
      chat_template_kwargs: { enable_thinking: false },
      abortSignal: signal,
      onData: (chunk) => {
        const choice = chunk.choices?.[0];
        const delta = choice?.delta?.content;
        if (delta) {
          text += delta;
          tokens++;
          onToken?.(text);
        }
        if (choice?.finish_reason) finishReason = choice.finish_reason;
      },
    });
    return { text, finishReason, tokens, ms: performance.now() - started };
  }
}
