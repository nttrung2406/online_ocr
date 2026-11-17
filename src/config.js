// Central configuration. Everything tunable lives here so the MVC layers stay generic.

// Note: Hugging Face "blob/" URLs are HTML pages; "resolve/" serves the raw file (CORS-enabled).
const GPU_REPO = 'https://huggingface.co/nawazsarwar/chandra-ocr-2-Q4_K_M-GGUF/resolve/main';
const CPU_REPO = 'https://huggingface.co/prithivMLmods/chandra-ocr-2-GGUF/resolve/main';

export const MODEL_NAME = 'Chandra OCR 2';

/**
 * Model variants. Each needs the LLM weights plus the vision projector (mmproj); without the
 * projector the model cannot see images.
 *
 * - gpu: the requested Q4_K_M build. Weights live in GPU buffers, outside the WASM heap.
 * - cpu: wllama's WebAssembly heap is capped at 4 GiB and on CPU every weight must fit inside
 *   it. Q4_K_M + f16 projector (3.8 GB) does not; Q4_K_S + Q8_0 projector (3.3 GB) leaves room
 *   for the KV cache and compute buffers. Smaller context, batches and image budget keep those bounded.
 */
export const MODELS = {
  gpu: {
    id: 'gpu',
    label: 'Q4_K_M · for WebGPU',
    quant: 'Q4_K_M',
    url: `${GPU_REPO}/chandra-ocr-2-q4_k_m.gguf`,
    mmprojUrl: `${GPU_REPO}/chandra-ocr-2.mmproj-f16.gguf`,
    approxBytes: 3_141_027_360 + 675_568_928,
    runtime: { n_ctx: 8192, n_batch: 2048, n_ubatch: 512, image_max_tokens: 2048 },
    maxTokens: 4096,
  },
  cpu: {
    id: 'cpu',
    label: 'Q4_K_S + Q8 vision · CPU-compatible',
    quant: 'Q4_K_S',
    url: `${CPU_REPO}/chandra-ocr-2.Q4_K_S.gguf`,
    mmprojUrl: `${CPU_REPO}/chandra-ocr-2.mmproj-q8_0.gguf`,
    approxBytes: 2_921_468_512 + 366_894_368,
    // Measured in Chromium: these fit in the 4 GiB heap; larger image/batch budgets abort while
    // reserving the vision encoder's compute buffers. 1024 is llama.cpp's minimum for Qwen-VL.
    runtime: { n_ctx: 4096, n_batch: 256, n_ubatch: 256, image_max_tokens: 1024 },
    maxTokens: 2304, // n_ctx − ≤1024 image tokens − ~650 prompt tokens
  },
};

/** Default variant for a device: the full Q4_K_M on hardware WebGPU, the CPU-sized one otherwise. */
export const defaultModelId = (caps) => (caps?.webgpu ? 'gpu' : 'cpu');

// "Balanced" accuracy preset: enough resolution for dense text, bounded image tokens so
// a page stays practical on consumer GPUs. llama.cpp further downscales to image_max_tokens.
export const IMAGE = {
  maxSide: 1600, // px, longest side sent to the model (~1.5–2k vision tokens per page)
  minSide: 896, // px, small screenshots / crops are upscaled to at least this (longest side)
  pdfMaxSide: 1600,
  mime: 'image/png',
};

// Prompt from datalab-to/chandra (chandra/prompts.py, "ocr" mode).
const ALLOWED_TAGS = [
  'math', 'br', 'i', 'b', 'u', 'del', 'sup', 'sub', 'table', 'tr', 'td', 'p', 'th', 'div',
  'pre', 'h1', 'h2', 'h3', 'h4', 'h5', 'ul', 'ol', 'li', 'input', 'a', 'span', 'img', 'hr',
  'tbody', 'small', 'caption', 'strong', 'thead', 'big', 'code', 'chem',
];
const ALLOWED_ATTRIBUTES = [
  'class', 'colspan', 'rowspan', 'display', 'checked', 'type', 'border', 'value', 'style',
  'href', 'alt', 'align', 'data-bbox', 'data-label',
];
const pyList = (xs) => `[${xs.map((x) => `'${x}'`).join(', ')}]`;

export const OCR_PROMPT = `OCR this image to HTML.

Only use these tags ${pyList(ALLOWED_TAGS)}, and these attributes ${pyList(ALLOWED_ATTRIBUTES)}.

Guidelines:
* Inline math: Surround math with <math>...</math> tags. Math expressions should be rendered in KaTeX-compatible LaTeX. Use display for block math.
* Tables: Use colspan and rowspan attributes to match table structure.
* Formatting: Maintain consistent formatting with the image, including spacing, indentation, subscripts/superscripts, and special characters.
* Images: Include a description of any images in the alt attribute of an <img> tag. Do not fill out the src property. Describe in detail inside the div tag. Also convert charts to high fidelity data, and convert diagrams to mermaid.
* Forms: Mark checkboxes and radio buttons properly.
* Text: join lines together properly into paragraphs using <p>...</p> tags.  Use <br> tags for line breaks within paragraphs, but only when absolutely necessary to maintain meaning.
* Chemistry: Use <chem>...</chem> tags for chemical formulas with reactive SMILES.
* Lists: Preserve indents and proper list markers.
* Use the simplest possible HTML structure that accurately represents the content of the block.
* Make sure the text is accurate and easy for a human to read and interpret.  Reading order should be correct and natural.`;

export const OUTPUT_TAGS = ALLOWED_TAGS;
export const OUTPUT_ATTRS = ALLOWED_ATTRIBUTES;
