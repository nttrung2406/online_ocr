// Legacy build: polyfills newer JS APIs (e.g. Uint8Array.toHex) for browsers a year or two old.
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { IMAGE } from '../config.js';

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export function detectKind(file) {
  const name = (file.name || '').toLowerCase();
  if (file.type === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
  if (file.type === DOCX_MIME || name.endsWith('.docx')) return 'docx';
  if (file.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp|avif)$/.test(name)) return 'image';
  return null;
}

/** Fit (w, h) so the longest side lands within [minSide, maxSide]. */
export function fitSize(w, h, maxSide = IMAGE.maxSide, minSide = IMAGE.minSide) {
  const longest = Math.max(w, h);
  let scale = 1;
  if (longest > maxSide) scale = maxSide / longest;
  else if (longest < minSide) scale = minSide / longest;
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

function makeCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff'; // flatten transparency: OCR expects dark text on light paper
  ctx.fillRect(0, 0, width, height);
  return { canvas, ctx };
}

const canvasToBlob = (canvas) =>
  new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Canvas encoding failed'))), IMAGE.mime),
  );

async function rasterizeImage(blob) {
  const bitmap = await createImageBitmap(blob);
  const { width, height } = fitSize(bitmap.width, bitmap.height);
  const { canvas, ctx } = makeCanvas(width, height);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  return { blob: await canvasToBlob(canvas), width, height };
}

async function* processPdf(file) {
  const task = pdfjs.getDocument({ data: await file.arrayBuffer() });
  const doc = await task.promise;
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const scale = IMAGE.pdfMaxSide / Math.max(base.width, base.height);
      const viewport = page.getViewport({ scale });
      const { canvas, ctx } = makeCanvas(Math.round(viewport.width), Math.round(viewport.height));
      await page.render({ canvasContext: ctx, canvas, viewport }).promise;
      page.cleanup();
      yield { kind: 'image', label: `Page ${n}/${doc.numPages}`, blob: await canvasToBlob(canvas), width: canvas.width, height: canvas.height };
    }
  } finally {
    await task.destroy();
  }
}

/**
 * DOCX is already digital text, so OCR would only lose fidelity. We extract the text
 * directly (mammoth) and send only the embedded images through OCR.
 */
async function* processDocx(file) {
  const { default: mammoth } = await import('mammoth/mammoth.browser.js');
  const images = [];
  const result = await mammoth.convertToHtml(
    { arrayBuffer: await file.arrayBuffer() },
    {
      convertImage: mammoth.images.imgElement(async (image) => {
        const bytes = await image.readAsArrayBuffer();
        images.push(new Blob([bytes], { type: image.contentType }));
        return { src: '', alt: `[embedded image ${images.length}]` };
      }),
    },
  );
  yield { kind: 'text', label: 'Document text', html: result.value };
  for (let i = 0; i < images.length; i++) {
    try {
      const r = await rasterizeImage(images[i]);
      yield { kind: 'image', label: `Embedded image ${i + 1}`, ...r };
    } catch {
      // Formats the browser can't decode (EMF/WMF) are skipped.
    }
  }
}

/**
 * Turn any supported file into OCR-ready pages.
 * @returns {AsyncGenerator<{kind:'image'|'text', label:string, blob?:Blob, width?:number, height?:number, html?:string}>}
 */
export async function* processFile(file) {
  const kind = detectKind(file);
  if (kind === 'pdf') yield* processPdf(file);
  else if (kind === 'docx') yield* processDocx(file);
  else if (kind === 'image') yield { kind: 'image', label: 'Image', ...(await rasterizeImage(file)) };
  else throw new Error(`Unsupported file type: ${file.name || file.type || 'unknown'}`);
}
