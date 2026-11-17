/*
 * Cross-origin isolation shim for static hosts that cannot set response headers.
 * Multi-threaded WebAssembly needs SharedArrayBuffer, which browsers only expose when the
 * page is served with COOP: same-origin + COEP: require-corp. When the server already
 * sends them (vite dev/preview, or a configured host) this script does nothing.
 *
 * Runs in two contexts: as a classic <script> in the page (registers itself), and as the
 * service worker (adds the headers to same-origin responses).
 */
if (typeof window === 'undefined') {
  // ---- Service worker context ----
  self.addEventListener('install', () => self.skipWaiting());
  self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
  self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.cache === 'only-if-cached' && req.mode !== 'same-origin') return;
    if (new URL(req.url).origin !== self.location.origin) return; // cross-origin: untouched (CORS)
    event.respondWith(
      fetch(req).then((res) => {
        if (res.status === 0) return res;
        const headers = new Headers(res.headers);
        headers.set('Cross-Origin-Opener-Policy', 'same-origin');
        headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
        headers.set('Cross-Origin-Resource-Policy', 'same-origin');
        return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
      }),
    );
  });
} else if (!window.crossOriginIsolated && window.isSecureContext && 'serviceWorker' in navigator) {
  // ---- Page context ----
  const KEY = 'coi-sw-reloaded';
  const src = document.currentScript.src;
  navigator.serviceWorker.register(src).then(
    (reg) => {
      const reloadOnce = () => {
        if (sessionStorage.getItem(KEY)) return; // avoid loops if isolation still fails
        sessionStorage.setItem(KEY, '1');
        location.reload();
      };
      if (reg.active && !navigator.serviceWorker.controller) reloadOnce();
      else if (!reg.active) reg.addEventListener('updatefound', () => {
        reg.installing?.addEventListener('statechange', (e) => e.target.state === 'activated' && reloadOnce());
      });
    },
    (err) => console.warn('COI service worker registration failed:', err),
  );
} else if (typeof window !== 'undefined' && window.crossOriginIsolated) {
  try { sessionStorage.removeItem('coi-sw-reloaded'); } catch {}
}
