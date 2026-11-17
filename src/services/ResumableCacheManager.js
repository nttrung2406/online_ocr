import { CacheManager, getHFFileSHA256 } from '@wllama/wllama';

const sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => (clearTimeout(t), reject(signal.reason)), { once: true });
  });

/**
 * A ReadableStream over `url` that survives dropped connections: when the network fails
 * mid-transfer it re-requests the rest with `Range: bytes=<received>-` and keeps going.
 * `maxRetries` counts consecutive failures; any received data resets the counter.
 */
export function resumableBody(url, { signal, headers = {}, onProgress, maxRetries = 8, fetchImpl = fetch } = {}) {
  let loaded = 0;
  let total = 0;
  let reader = null;
  let failures = 0;

  const open = async () => {
    const h = { ...headers };
    if (loaded > 0) h.Range = `bytes=${loaded}-`;
    const res = await fetchImpl(url, { headers: h, signal });
    if (loaded > 0 && res.status !== 206) {
      const err = new Error(`Server cannot resume download (HTTP ${res.status})`);
      err.fatal = true;
      throw err;
    }
    if (!res.ok || !res.body) {
      const err = new Error(`HTTP ${res.status} while downloading ${url.split('/').pop()}`);
      err.fatal = res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429;
      throw err;
    }
    if (!total) total = loaded + Number(res.headers.get('content-length') || 0);
    reader = res.body.getReader();
  };

  const stream = new ReadableStream({
    async pull(controller) {
      for (;;) {
        try {
          if (!reader) await open();
          const { done, value } = await reader.read();
          if (done) {
            if (total && loaded < total) throw new Error(`Connection closed early (${loaded}/${total} bytes)`);
            controller.close();
            return;
          }
          loaded += value.byteLength;
          failures = 0;
          onProgress?.(loaded, total);
          controller.enqueue(value);
          return;
        } catch (err) {
          reader = null;
          if (signal?.aborted || err.fatal || ++failures > maxRetries) throw err;
          console.warn(`Download interrupted at ${loaded} bytes (${err.message}); retry ${failures}/${maxRetries}`);
          await sleep(Math.min(500 * 2 ** failures, 15000), signal);
        }
      }
    },
    cancel(reason) {
      return reader?.cancel(reason);
    },
  });

  return { stream, get loaded() { return loaded; }, get total() { return total; } };
}

/**
 * Drop-in CacheManager whose download() resumes after network errors instead of failing
 * a multi-GB transfer. Uses the same storage keys and metadata as wllama's own download(),
 * so ModelManager / Model.validate() / loadModel() work unchanged.
 */
export class ResumableCacheManager extends CacheManager {
  async download(url, options = {}) {
    const fileKey = await this.getNameFromURL(url);
    const sha256 = await getHFFileSHA256(url, options.headers ?? {}).catch(() => null);
    const hint = sha256 ? { sha256 } : undefined;

    const cachedSize = await this.sb.getSize(fileKey, hint);
    if (cachedSize !== -1) {
      const meta = await this.getMetadata(fileKey);
      if (meta?.originalURL === url && meta.originalSize === cachedSize) {
        options.progressCallback?.({ loaded: cachedSize, total: cachedSize });
        return;
      }
      await this.delete(fileKey);
    }

    let lastReport = 0;
    const body = resumableBody(url, {
      signal: options.signal,
      headers: options.headers,
      onProgress: (loaded, total) => {
        const now = Date.now();
        if (now - lastReport > 150) {
          lastReport = now;
          options.progressCallback?.({ loaded, total });
        }
      },
    });
    await this.sb.write(fileKey, body.stream, hint);
    options.progressCallback?.({ loaded: body.loaded, total: body.total || body.loaded });

    const metadata = { originalURL: url, originalSize: body.total || body.loaded, etag: '', ...(options.metadataAdditional ?? {}) };
    if (sha256) metadata.sha256 = sha256;
    await this.writeMetadata(fileKey, metadata);
  }
}
