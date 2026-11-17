import { $ } from './dom.js';

const LABELS = { auto: '◐ Auto', light: '☀ Light', dark: '☾ Dark' };

export class ThemeView {
  constructor() {
    this.button = $('#theme-toggle');
  }

  bindToggle(handler) {
    this.button.addEventListener('click', handler);
  }

  render(mode) {
    const root = document.documentElement;
    if (mode === 'auto') delete root.dataset.theme;
    else root.dataset.theme = mode;
    this.button.textContent = LABELS[mode];
    this.button.title = `Theme: ${mode} (click to change)`;
  }
}
