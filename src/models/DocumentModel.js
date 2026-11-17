import { EventEmitter } from '../core/EventEmitter.js';

let nextId = 1;

/**
 * A "page" is the unit of OCR work.
 *  kind 'image': rasterized page/image → OCR'd by the model.
 *  kind 'text' : text taken directly from a DOCX (already machine-readable, no OCR needed).
 * status: 'pending' | 'running' | 'done' | 'error'
 */
export class DocumentModel extends EventEmitter {
  pages = [];

  addPages(pages) {
    const created = pages.map((p) => ({
      id: nextId++,
      status: p.kind === 'text' ? 'done' : 'pending',
      html: p.html ?? '',
      error: null,
      stats: null,
      ...p,
    }));
    this.pages.push(...created);
    this.emit('pages', this.pages);
    return created;
  }

  updatePage(id, patch) {
    const page = this.get(id);
    if (!page) return;
    Object.assign(page, patch);
    this.emit('page', page);
  }

  removePage(id) {
    const page = this.get(id);
    if (!page) return;
    if (page.previewUrl) URL.revokeObjectURL(page.previewUrl);
    this.pages = this.pages.filter((p) => p.id !== id);
    this.emit('pages', this.pages);
  }

  clear() {
    for (const p of this.pages) if (p.previewUrl) URL.revokeObjectURL(p.previewUrl);
    this.pages = [];
    this.emit('pages', this.pages);
  }

  get(id) {
    return this.pages.find((p) => p.id === id);
  }

  pending() {
    return this.pages.filter((p) => p.kind === 'image' && p.status === 'pending');
  }

  completed() {
    return this.pages.filter((p) => p.status === 'done' && p.html);
  }
}
