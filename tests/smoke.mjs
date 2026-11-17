// Browser smoke test: builds nothing, serves `dist/` via `vite preview`, drives Chromium.
//   node tests/smoke.mjs            → UI + document pipeline (no model download)
//   FULL=1 node tests/smoke.mjs     → also downloads the ~3.8 GB model and OCRs sample.png
// Env: CHROME=/path/to/chrome, OUT=/dir/for/screenshots, PROFILE=/persistent/profile/dir
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, mkdirSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';

const ROOT = resolve(import.meta.dirname, '..');
const FIX = join(ROOT, 'tests/fixtures');
const OUT = process.env.OUT || join(tmpdir(), 'online-ocr-smoke');
const FULL = process.env.FULL === '1';
// Fixed port: OPFS (the model cache) is per-origin, so a stable origin lets FULL runs reuse the download.
const PORT = Number(process.env.PORT || 4173);
mkdirSync(OUT, { recursive: true });

function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const base = join(homedir(), '.cache/ms-playwright');
  const dirs = existsSync(base) ? readdirSync(base).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse() : [];
  for (const d of dirs) {
    const p = join(base, d, 'chrome-linux/chrome');
    if (existsSync(p)) return p;
  }
  throw new Error('No Chromium found; set CHROME=/path/to/chrome');
}

const server = spawn(join(ROOT, 'node_modules/.bin/vite'), ['preview', '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: 'pipe', detached: true });
const stopServer = () => {
  try {
    process.kill(-server.pid, 'SIGTERM'); // whole process group
  } catch {
    server.kill('SIGTERM');
  }
};
await new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error('vite preview did not start')), 20000);
  server.stdout.on('data', (d) => String(d).includes(String(PORT)) && (clearTimeout(t), res()));
});

let failures = 0;
const check = (cond, msg) => {
  console.log(`${cond ? '✓' : '✗'} ${msg}`);
  if (!cond) failures++;
};

const args = ['--enable-unsafe-webgpu', '--enable-features=Vulkan'];
const context = await chromium.launchPersistentContext(process.env.PROFILE || join(OUT, 'profile'), {
  executablePath: findChrome(),
  headless: true,
  args,
  viewport: { width: 1280, height: 900 },
});
const page = context.pages()[0] ?? (await context.newPage());
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
// Error toasts (e.g. "Could not read …") are user-visible failures too.
await page.exposeFunction('__reportToast', (t) => /could not|failed/i.test(t) && errors.push(`toast: ${t}`));
await page.addInitScript(() => {
  document.addEventListener('DOMContentLoaded', () => {
    const el = document.querySelector('#toast');
    new MutationObserver(() => window.__reportToast(el.textContent)).observe(el, { childList: true, characterData: true, subtree: true });
  });
});

try {
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForFunction(() => !/Checking/.test(document.querySelector('#engine-status').textContent), null, { timeout: 20000 });

  const info = await page.evaluate(() => ({
    title: document.title,
    coi: crossOriginIsolated,
    status: document.querySelector('#engine-status').textContent,
    primary: document.querySelector('#engine-primary').textContent,
    chips: [...document.querySelectorAll('#engine-caps .chip')].map((c) => c.textContent),
    warnings: [...document.querySelectorAll('#engine-warnings li')].map((c) => c.textContent),
    display: getComputedStyle(document.querySelector('.layout')).display,
  }));
  console.log('  engine:', info.status, '|', info.primary, '\n  chips:', info.chips.join(' · '), '\n  warnings:', info.warnings);
  check(info.title === 'Browser OCR', 'page title');
  check(info.coi, 'cross-origin isolated (multi-thread WASM available)');
  check(info.display === 'flex', 'layout uses flexbox');
  check(/Download model|Load model/.test(info.primary), 'download / load button offered');

  // Theme cycling auto → light → dark
  const bgs = [];
  for (let i = 0; i < 3; i++) {
    await page.waitForTimeout(350); // let color transitions settle
    bgs.push(await page.evaluate(() => [document.documentElement.dataset.theme ?? 'auto', getComputedStyle(document.body).backgroundColor]));
    await page.screenshot({ path: join(OUT, `theme-${bgs.at(-1)[0]}.png`) });
    await page.click('#theme-toggle');
  }
  console.log('  themes:', bgs.map((b) => b.join('=')).join(', '));
  check(bgs[1][0] === 'light' && bgs[2][0] === 'dark' && bgs[1][1] !== bgs[2][1], 'light/dark themes switch colors');

  // Uploads: PNG (1) + PDF (2 pages) + DOCX (text + 1 embedded image)
  await page.setInputFiles('#file-input', [join(FIX, 'sample.png'), join(FIX, 'sample.pdf'), join(FIX, 'sample.docx')]);
  await page.waitForFunction(() => document.querySelectorAll('.page').length >= 5, null, { timeout: 30000 });

  // Clipboard paste of an image
  await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 300;
    c.height = 120;
    const g = c.getContext('2d');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, 300, 120);
    g.fillStyle = '#000';
    g.font = '32px sans-serif';
    g.fillText('Pasted text', 20, 70);
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    const dt = new DataTransfer();
    dt.items.add(new File([blob], 'image.png', { type: 'image/png' }));
    document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }));
  });
  await page.waitForFunction(() => document.querySelectorAll('.page').length >= 6, null, { timeout: 10000 });

  const pages = await page.evaluate(() =>
    window.__ocr.docs.pages.map((p) => ({ src: p.sourceName, label: p.label, kind: p.kind, status: p.status, size: p.width ? `${p.width}x${p.height}` : '' })),
  );
  console.table(pages);
  check(pages.filter((p) => p.src === 'sample.pdf').length === 2, 'PDF rendered to 2 page images');
  check(pages.some((p) => p.src === 'sample.docx' && p.kind === 'text'), 'DOCX text extracted');
  check(pages.some((p) => p.src === 'sample.docx' && p.kind === 'image'), 'DOCX embedded image queued for OCR');
  check(pages.some((p) => p.src.startsWith('pasted-')), 'pasted image added');
  check(pages.filter((p) => p.size).every((p) => Math.max(...p.size.split('x').map(Number)) <= 1600), 'images within balanced size limit');
  const docxText = await page.evaluate(() => window.__ocr.docs.pages.find((p) => p.kind === 'text')?.html);
  check(/Meeting Notes/.test(docxText) && /ship the browser-only OCR/.test(docxText), 'DOCX content correct');
  check(await page.isDisabled('#run-btn'), 'Run OCR disabled until model loaded');
  await page.screenshot({ path: join(OUT, 'pages.png'), fullPage: true });

  // Phone width: no horizontal scroll
  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  await page.screenshot({ path: join(OUT, 'mobile.png') });
  check(overflow <= 0, `no horizontal overflow at phone width (${overflow}px)`);
  await page.setViewportSize({ width: 1280, height: 900 });

  if (FULL) {
    console.log('\n— FULL mode: model download + OCR —');
    await page.click('#clear-btn');
    if ((await page.textContent('#engine-primary')).startsWith('Download')) await page.click('#engine-primary');
    else if ((await page.textContent('#engine-primary')).startsWith('Load')) await page.click('#engine-primary');
    const t0 = Date.now();
    let lastPrint = 0;
    while (true) {
      const s = await page.evaluate(() => ({ ...window.__ocr.engineModel.state, capabilities: undefined }));
      if (Date.now() - lastPrint > 15000) {
        lastPrint = Date.now();
        const p = s.progress;
        console.log(`  [${Math.round((Date.now() - t0) / 1000)}s] ${s.status} ${p.total ? ((p.loaded / p.total) * 100).toFixed(1) + '%' : ''}`);
      }
      if (s.status === 'ready') break;
      if (s.status === 'error' || s.status === 'absent') {
        console.log('  runtime log:\n' + (await page.textContent('#engine-log')).split('\n').slice(-40).join('\n'));
        throw new Error(`engine failed: ${s.error}`);
      }
      await page.waitForTimeout(2000);
    }
    const st = await page.evaluate(() => window.__ocr.engineModel.state);
    console.log(`  ready on ${st.backend} (${st.threads} threads) after ${Math.round((Date.now() - t0) / 1000)}s`);
    await page.setInputFiles('#file-input', [join(FIX, 'sample.png')]);
    const t1 = Date.now();
    await page.waitForFunction(() => window.__ocr.docs.pages.some((p) => p.status === 'done' || p.status === 'error'), null, { timeout: 0, polling: 3000 });
    const res = await page.evaluate(() => window.__ocr.docs.pages[0]);
    console.log(`  OCR ${res.status} in ${Math.round((Date.now() - t1) / 1000)}s`, res.stats ?? '', res.error ?? '');
    console.log('  output:\n' + res.html);
    await page.screenshot({ path: join(OUT, 'ocr-result.png'), fullPage: true });
    check(res.status === 'done' && /Invoice/i.test(res.html) && /44\.80/.test(res.html), 'model OCR output contains expected text');
  }

  const relevant = errors.filter((e) => !/favicon|DevTools/.test(e));
  if (relevant.length) console.log('  page errors:', relevant);
  check(relevant.length === 0, 'no page errors');
} catch (err) {
  console.error('✗ smoke test crashed:', err);
  failures++;
} finally {
  await context.close();
  stopServer();
}
console.log(`\nScreenshots in ${OUT}\n${failures ? `${failures} check(s) failed` : 'All checks passed'}`);
process.exit(failures ? 1 : 0);
