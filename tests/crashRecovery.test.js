import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({ GlobalWorkerOptions: {} }));
vi.mock('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url', () => ({ default: '' }));
const { DocumentController } = await import('../src/controllers/DocumentController.js');
const { DocumentModel } = await import('../src/models/DocumentModel.js');
const { EngineModel } = await import('../src/models/EngineModel.js');

const noopView = () => new Proxy({}, { get: () => () => {} });
const crash = (gpuTimeout) => Object.assign(new Error('boom'), { code: 'engine_crashed', gpuTimeout });

function setup(recognizeImpl, recoverOk = true) {
  globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  const docs = new DocumentModel();
  const engineModel = new EngineModel();
  engineModel.update({ status: 'ready' });
  const engine = { recognize: vi.fn(recognizeImpl) };
  const recoverEngine = vi.fn(async () => {
    engineModel.update({ status: recoverOk ? 'ready' : 'error' });
    return recoverOk;
  });
  const ctl = new DocumentController({ docs, engineModel, engine, uploadView: noopView(), pagesView: noopView(), recoverEngine });
  const [page] = docs.addPages([{ kind: 'image', label: 'p1', blob: new Blob(['x']) }]);
  return { ctl, docs, engine, recoverEngine, page };
}

describe('crash recovery', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('reloads the engine and retries the page after a GPU timeout', async () => {
    let calls = 0;
    const { ctl, docs, recoverEngine, page } = setup(async () => {
      if (++calls === 1) throw crash(true);
      return { text: '<p>ok</p>', finishReason: 'stop', tokens: 3, ms: 10 };
    });
    await ctl.run();
    expect(recoverEngine).toHaveBeenCalledTimes(1);
    expect(recoverEngine.mock.calls[0][0].gpuTimeout).toBe(true);
    expect(docs.get(page.id).status).toBe('done');
    expect(docs.get(page.id).html).toBe('<p>ok</p>');
  });

  it('marks the page failed if it crashes the engine again after reloading', async () => {
    const { ctl, docs, engine, page } = setup(async () => {
      throw crash(false);
    });
    await ctl.run();
    expect(engine.recognize).toHaveBeenCalledTimes(2);
    expect(docs.get(page.id).status).toBe('error');
  });

  it('stops the queue when the engine cannot be reloaded', async () => {
    const { ctl, docs, engine, page } = setup(async () => {
      throw crash(true);
    }, false);
    await ctl.run();
    expect(engine.recognize).toHaveBeenCalledTimes(1);
    expect(docs.get(page.id).status).toBe('pending'); // kept for a later run
  });

  it('does not mistake a native "(ABORT)" message for a user cancel', async () => {
    const { ctl, docs, page } = setup(async () => {
      throw new Error('(ABORT) something native');
    });
    await ctl.run();
    expect(docs.get(page.id).status).toBe('error');
  });
});
