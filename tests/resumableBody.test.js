import { describe, it, expect, vi } from 'vitest';

vi.mock('@wllama/wllama', () => ({ CacheManager: class {}, getHFFileSHA256: async () => null }));
const { resumableBody } = await import('../src/services/ResumableCacheManager.js');

const DATA = new Uint8Array(1000).map((_, i) => i % 251);

/** Fake fetch serving DATA; the first `drops` responses die after `dropAfter` bytes. */
function flakyFetch({ drops = 1, dropAfter = 300, rangeSupported = true } = {}) {
  const calls = [];
  const impl = async (_url, { headers = {} } = {}) => {
    calls.push(headers.Range ?? null);
    const start = headers.Range ? Number(/bytes=(\d+)-/.exec(headers.Range)[1]) : 0;
    if (start && !rangeSupported) return new Response(DATA, { status: 200 });
    const slice = DATA.slice(start);
    const willDrop = calls.length <= drops;
    let sent = 0;
    const body = new ReadableStream({
      pull(c) {
        if (willDrop && sent >= dropAfter) return c.error(new TypeError('network error'));
        if (sent >= slice.length) return c.close();
        const chunk = slice.slice(sent, sent + 100);
        sent += chunk.length;
        c.enqueue(chunk);
      },
    });
    return new Response(body, { status: start ? 206 : 200, headers: { 'content-length': String(slice.length) } });
  };
  return { impl, calls };
}

const readAll = async (stream) => new Uint8Array(await new Response(stream).arrayBuffer());

describe('resumableBody', () => {
  it('resumes with a Range request after a dropped connection and yields intact bytes', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { impl, calls } = flakyFetch({ drops: 2, dropAfter: 300 });
    const body = resumableBody('https://x/model.gguf', { fetchImpl: impl, maxRetries: 3 });
    const out = await readAll(body.stream);
    expect(out).toEqual(DATA);
    expect(calls).toEqual([null, 'bytes=300-', 'bytes=600-']);
    expect(body.total).toBe(1000);
  }, 20000);

  it('fails fast when the server ignores Range', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { impl } = flakyFetch({ drops: 1, rangeSupported: false });
    const body = resumableBody('https://x/model.gguf', { fetchImpl: impl, maxRetries: 3 });
    await expect(readAll(body.stream)).rejects.toThrow(/cannot resume/);
  }, 20000);

  it('gives up after maxRetries consecutive failures', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const impl = async () => { throw new TypeError('offline'); };
    const body = resumableBody('https://x/model.gguf', { fetchImpl: impl, maxRetries: 1 });
    await expect(readAll(body.stream)).rejects.toThrow(/offline/);
  }, 20000);
});
