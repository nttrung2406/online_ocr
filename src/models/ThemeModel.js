import { EventEmitter } from '../core/EventEmitter.js';

const KEY = 'online-ocr:theme';
const MODES = ['auto', 'light', 'dark'];

/** Theme preference: 'auto' follows the OS (prefers-color-scheme). */
export class ThemeModel extends EventEmitter {
  constructor() {
    super();
    let saved = null;
    try {
      saved = localStorage.getItem(KEY);
    } catch {
      /* storage blocked — fall back to auto */
    }
    this.mode = MODES.includes(saved) ? saved : 'auto';
  }

  cycle() {
    this.set(MODES[(MODES.indexOf(this.mode) + 1) % MODES.length]);
  }

  set(mode) {
    this.mode = mode;
    try {
      localStorage.setItem(KEY, mode);
    } catch {
      /* ignore */
    }
    this.emit('change', mode);
  }
}
