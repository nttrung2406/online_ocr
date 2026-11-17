import { defineConfig } from 'vite';

// Multi-threaded WASM needs SharedArrayBuffer, which requires cross-origin isolation.
// These headers cover `vite dev` / `vite preview`. For static hosts that can't set
// headers (e.g. GitHub Pages), public/coi-serviceworker.js injects them client-side.
const isolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export default defineConfig({
  base: './',
  server: { headers: isolationHeaders },
  preview: { headers: isolationHeaders },
  optimizeDeps: { exclude: ['@wllama/wllama'] },
  build: { target: 'es2022', chunkSizeWarningLimit: 4000 },
  worker: { format: 'es' },
});
