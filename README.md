# online_ocr — Browser-only OCR with Chandra OCR 2

Private OCR that runs **entirely in the browser**: no backend, no uploads. The
[Chandra OCR 2](https://huggingface.co/datalab-to/chandra-ocr-2) vision-language model
GGUF is downloaded once from Hugging Face and cached in browser storage (OPFS). After that,
inference runs locally on **WebGPU**, or on **CPU (multi-threaded WebAssembly)** with a smaller variant.

```bash
npm install
npm run dev        # http://localhost:5173  (sends the COOP/COEP headers)
npm run build      # static site in dist/
npm run preview    # serve dist/ with the right headers
npm test           # unit tests (vitest)
npm run smoke      # headless-Chromium UI test, no model download (needs `npm run build`)
FULL=1 npm run smoke   # also downloads the model variant for this device and OCRs a sample image
```

## Feasibility summary

| Requirement | Verdict | How |
|---|---|---|
| Chandra OCR 2 GGUF Q4_K_M | ✅ | WebGPU variant: [`nawazsarwar/chandra-ocr-2-Q4_K_M-GGUF`](https://huggingface.co/nawazsarwar/chandra-ocr-2-Q4_K_M-GGUF), LLM 3.14 GB + vision projector `mmproj-f16` 0.68 GB. The projector is **required**: without it the model cannot see images. |
| 100% browser-side, no backend | ✅ | [wllama 3](https://github.com/ngxson/wllama) = llama.cpp compiled to WebAssembly, with WebGPU and multimodal support. Its bundled llama.cpp supports the `qwen35` architecture Chandra 2 uses. |
| WebGPU with CPU fallback | ✅ CPU verified | wllama's WASM heap is compiled with a **4 GiB maximum**, and on CPU every weight must fit inside it. Q4_K_M + f16 projector does not fit (verified: the projector allocation fails). Devices without a hardware GPU therefore use a **CPU-compatible variant**, [`prithivMLmods/chandra-ocr-2-GGUF`](https://huggingface.co/prithivMLmods/chandra-ocr-2-GGUF) Q4_K_S (2.92 GB) + Q8_0 projector (0.37 GB), with `n_ctx 4096`, batch 256 and ≤1024 image tokens. Verified in Chromium: it loads and OCRs correctly. The variant is picked automatically and can be changed in the UI. Software GPUs (SwiftShader) count as "no GPU". |
| Model > 4 GB address space | ⚠️ | Needs **64-bit WebAssembly memory** (Chrome/Edge 133+, Firefox 134+). Safari's 32-bit fallback cannot hold the model, so Safari and iOS are unsupported. |
| Initial download over internet | ✅ verified | Hugging Face `resolve/` URLs are CORS-enabled. The download **resumes after network drops** (HTTP Range) and requests persistent storage. Measured: about 4–5 minutes for 3.3–3.8 GB on a ~15 MB/s link. |
| Subsequent inference local | ✅ | Files live in OPFS. Later visits load from disk, with no network needed for inference. |
| PDF / DOCX / image / paste | ✅ | pdf.js renders PDF pages. DOCX text is extracted directly with mammoth (it is already digital, so OCR would only lose fidelity), and embedded DOCX images are OCR'd. Images come from the file picker, drag-drop or Ctrl+V. |
| "Balanced" accuracy | ✅ | Pages are rasterized to ≤1600 px on the long side, using Chandra's official `ocr` prompt with greedy decoding. Image-token budget: 2048 on WebGPU, 1024 on CPU (llama.cpp's recommended minimum for Qwen-VL). |

**Verification status.**
- `npm test` / `npm run smoke` cover the UI and the PDF/DOCX/image/paste pipelines.
- `FULL=1 npm run smoke` was run in headless Chromium (WSL, 12-core CPU, no GPU). The CPU variant downloaded (3.29 GB), loaded in about 14 s and transcribed the sample invoice correctly (heading plus table) in about 7–8 minutes on 6 threads.
- **Hardware WebGPU inference is not verified yet.** This environment exposes no GPU adapter to the wllama worker, so run `FULL=1 npm run smoke` (or just use the app) on a GPU machine.

**Practical limits.**
- CPU mode takes minutes per page and needs about 5 GB of free RAM.
- WebGPU should be much faster; a GPU with ≥6 GB of VRAM (or a recent integrated GPU with shared memory) is comfortable.
- Safari, iOS and phones are not realistic targets.
- `?backend=webgpu|cpu` and `?n_ctx=&n_batch=&n_ubatch=&image_max_tokens=` override the defaults when troubleshooting.

## Architecture (MVC, vanilla ES modules + Vite)

```
src/
  config.js                 model variants (URLs, runtime presets), image preset, Chandra prompt
  main.js                   composition root (wires M ⇄ C ⇄ V)
  core/EventEmitter.js
  models/                   state only, emits change events
    EngineModel.js          variant + status: checking → absent → downloading → cached → loading → ready
    DocumentModel.js        pages queue (pending/running/done/error)
    ThemeModel.js           auto / light / dark (persisted)
  views/                    DOM rendering + user intents, no business logic
    EngineView.js  UploadView.js  PagesView.js  ThemeView.js  dom.js
  controllers/              orchestrate models, views and services
    EngineController.js     capability check, download, load, delete
    DocumentController.js   import → sequential OCR (streaming) → export
    ThemeController.js
  services/                 framework-free logic
    OcrEngine.js            wllama wrapper: cache, WebGPU→CPU load, streaming OCR
    ResumableCacheManager.js  resumable multi-GB downloads into OPFS
    DocumentProcessor.js    PDF/DOCX/image → page images
    capabilities.js         WebGPU / WASM64 / threads / storage probe
    outputFormat.js         sanitize model HTML, HTML → Markdown / text
```

Model output is HTML (Chandra's format). It is sanitized with DOMPurify against Chandra's tag
allow-list before being shown, and can be viewed or exported as HTML, Markdown or plain text.

## Deploying

Any static host works. Multi-threaded WASM needs **cross-origin isolation**, so serve with:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

On hosts that cannot set headers (e.g. GitHub Pages), `public/coi-serviceworker.js` injects
them client-side after one automatic reload. HTTPS (or localhost) is required for WebGPU, OPFS
and service workers.
