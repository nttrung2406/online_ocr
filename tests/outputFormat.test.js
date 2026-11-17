import { describe, it, expect } from 'vitest';
import { cleanModelOutput, sanitizeHtml, htmlToMarkdown, htmlToText, formatBytes, formatDuration } from '../src/services/outputFormat.js';

describe('cleanModelOutput', () => {
  it('strips code fences and think blocks', () => {
    expect(cleanModelOutput('```html\n<p>Hi</p>\n```')).toBe('<p>Hi</p>');
    expect(cleanModelOutput('<think>\n\n</think>\n<p>x</p>')).toBe('<p>x</p>');
    expect(cleanModelOutput(null)).toBe('');
  });
});

describe('sanitizeHtml', () => {
  it('removes scripts, handlers and disallowed tags but keeps table structure', () => {
    const out = sanitizeHtml('<p onclick="x()">a</p><script>alert(1)</script><iframe></iframe><table><tr><td colspan="2">b</td></tr></table>');
    expect(out).not.toMatch(/script|onclick|iframe/);
    expect(out).toContain('colspan="2"');
  });
  it('drops href/style to avoid javascript: links and CSS injection', () => {
    const out = sanitizeHtml('<a href="javascript:alert(1)" style="position:fixed">x</a>');
    expect(out).toBe('<a>x</a>');
  });
});

describe('htmlToMarkdown', () => {
  it('converts headings, tables, math and checkboxes', () => {
    const md = htmlToMarkdown(
      '<h2>Title</h2><p>E = <math>mc^2</math></p><math display="block">x^2</math>' +
        '<table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>' +
        '<p><input type="checkbox" checked> done</p>',
    );
    expect(md).toContain('## Title');
    expect(md).toContain('$mc^2$');
    expect(md).toContain('$$x^2$$');
    expect(md).toMatch(/\| A \| B \|/);
    expect(md).toContain('[x]');
  });
});

describe('htmlToText', () => {
  it('keeps line structure', () => {
    expect(htmlToText('<p>one<br>two</p><p>three</p>')).toBe('one\ntwo\nthree');
  });
});

describe('formatters', () => {
  it('formats bytes and durations', () => {
    expect(formatBytes(3_816_596_288)).toBe('3.82 GB');
    expect(formatBytes(675_568_928)).toBe('675.57 MB');
    expect(formatBytes(0)).toBe('0 B');
    expect(formatDuration(65_000)).toBe('1m 5s');
    expect(formatDuration(NaN)).toBe('—');
  });
});
