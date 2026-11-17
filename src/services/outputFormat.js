import DOMPurify from 'dompurify';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
import { OUTPUT_TAGS, OUTPUT_ATTRS } from '../config.js';

/** Strip markdown code fences / chat noise the model sometimes wraps around its HTML. */
export function cleanModelOutput(raw) {
  let s = String(raw ?? '').trim();
  s = s.replace(/^<think>[\s\S]*?<\/think>\s*/i, '');
  s = s.replace(/^```(?:html)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');
  return s.trim();
}

/** Model output is untrusted HTML: allow only Chandra's documented tags/attributes. */
export function sanitizeHtml(html) {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [...OUTPUT_TAGS, 'em', 'blockquote'],
    ALLOWED_ATTR: OUTPUT_ATTRS.filter((a) => a !== 'style' && a !== 'href'),
    ALLOW_DATA_ATTR: false,
  });
}

let turndown;
function getTurndown() {
  if (turndown) return turndown;
  turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-' });
  turndown.use(gfm);
  turndown.addRule('math', {
    filter: (node) => node.nodeName.toUpperCase() === 'MATH',
    replacement: (_content, node) =>
      node.hasAttribute('display') ? `\n\n$$${node.textContent}$$\n\n` : `$${node.textContent}$`,
  });
  turndown.addRule('img-alt', {
    filter: 'img',
    replacement: (_c, node) => (node.getAttribute('alt') ? `*[Image: ${node.getAttribute('alt')}]*` : ''),
  });
  turndown.addRule('checkbox', {
    filter: (node) => node.nodeName.toUpperCase() === 'INPUT' && /checkbox|radio/i.test(node.getAttribute('type') || ''),
    replacement: (_c, node) => (node.hasAttribute('checked') ? '[x] ' : '[ ] '),
  });
  return turndown;
}

export function htmlToMarkdown(html) {
  return getTurndown().turndown(sanitizeHtml(html)).trim();
}

export function htmlToText(html) {
  const div = document.createElement('div');
  div.innerHTML = sanitizeHtml(html)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h\d|li|tr)>/gi, '$&\n');
  return div.textContent.replace(/\n{3,}/g, '\n\n').trim();
}

export function formatBytes(n) {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB'];
  // Decimal units, matching how Hugging Face and OS file managers report sizes.
  const i = Math.min(u.length - 1, Math.floor(Math.log10(n) / 3));
  return `${(n / 1000 ** i).toFixed(i >= 2 ? 2 : 0)} ${u[i]}`;
}

export function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m ${s % 60}s` : `${Math.floor(m / 60)}h ${m % 60}m`;
}
