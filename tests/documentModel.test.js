import { describe, it, expect, vi } from 'vitest';
import { DocumentModel } from '../src/models/DocumentModel.js';

vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({ GlobalWorkerOptions: {} }));
vi.mock('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url', () => ({ default: '' }));
const { fitSize, detectKind } = await import('../src/services/DocumentProcessor.js');

describe('DocumentModel', () => {
  it('queues image pages, marks docx text as done, and tracks completion', () => {
    const m = new DocumentModel();
    const events = [];
    m.on('pages', () => events.push('pages'));
    const [img, txt] = m.addPages([{ kind: 'image', label: 'p1' }, { kind: 'text', label: 'doc', html: '<p>x</p>' }]);
    expect(img.status).toBe('pending');
    expect(txt.status).toBe('done');
    expect(m.pending().map((p) => p.id)).toEqual([img.id]);
    m.updatePage(img.id, { status: 'error' });
    expect(m.pending()).toHaveLength(0); // errors need an explicit retry
    m.updatePage(img.id, { status: 'done', html: '<p>y</p>' });
    expect(m.completed()).toHaveLength(2);
    m.removePage(txt.id);
    expect(m.pages).toHaveLength(1);
    expect(events).toEqual(['pages', 'pages']);
  });
});

describe('DocumentProcessor helpers', () => {
  it('fits images into the balanced size window', () => {
    expect(fitSize(3200, 1600, 1600, 896)).toEqual({ width: 1600, height: 800 });
    expect(fitSize(400, 300, 1600, 896)).toEqual({ width: 896, height: 672 });
    expect(fitSize(1200, 900, 1600, 896)).toEqual({ width: 1200, height: 900 });
  });
  it('detects file kinds by mime or extension', () => {
    expect(detectKind({ name: 'a.PDF', type: '' })).toBe('pdf');
    expect(detectKind({ name: 'a.docx', type: '' })).toBe('docx');
    expect(detectKind({ name: 'shot', type: 'image/png' })).toBe('image');
    expect(detectKind({ name: 'a.txt', type: 'text/plain' })).toBe(null);
  });
});
