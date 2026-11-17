import { MODELS } from '../config.js';

const supportsMemory64 = () => {
  try {
    new WebAssembly.Memory({ address: 'i64', initial: 1n });
    return true;
  } catch {
    return false;
  }
};

/**
 * Probe what this browser/device can do. The model needs ~3.8 GB of weights in memory,
 * which is only addressable with 64-bit WebAssembly memory (Chrome/Edge 133+, Firefox 134+).
 */
export async function detectCapabilities() {
  const caps = {
    webgpu: false,
    gpuName: null,
    memory64: supportsMemory64(),
    threads: globalThis.crossOriginIsolated === true,
    cores: navigator.hardwareConcurrency || 1,
    deviceMemoryGB: navigator.deviceMemory ?? null, // Chromium only, capped at 8
    storageQuota: null,
    storageUsage: null,
  };

  if ('gpu' in navigator) {
    try {
      const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
      if (adapter) {
        const info = adapter.info ?? {};
        caps.gpuName = [info.vendor, info.architecture || info.description].filter(Boolean).join(' ') || 'WebGPU adapter';
        // A software rasterizer (SwiftShader / fallback adapter) is far slower than WASM SIMD on CPU.
        caps.softwareGpu = !!(info.isFallbackAdapter || adapter.isFallbackAdapter) || /swiftshader|llvmpipe|software/i.test(caps.gpuName);
        caps.webgpu = !caps.softwareGpu;
      }
    } catch {
      /* no adapter */
    }
  }

  try {
    const est = await navigator.storage?.estimate?.();
    if (est) {
      caps.storageQuota = est.quota ?? null;
      caps.storageUsage = est.usage ?? null;
    }
  } catch {
    /* ignore */
  }

  caps.supported = caps.memory64;
  caps.warnings = [];
  if (!caps.memory64)
    caps.warnings.push('This browser lacks 64-bit WebAssembly memory, so the 3.8 GB model cannot be loaded. Use a recent Chrome, Edge or Firefox on desktop.');
  if (!caps.webgpu)
    caps.warnings.push(
      `${caps.softwareGpu ? `Only a software GPU (${caps.gpuName}) is available` : 'No hardware WebGPU'}: ` +
        'using the CPU-compatible model variant. Expect several minutes per page.',
    );
  if (!caps.threads)
    caps.warnings.push('Page is not cross-origin isolated, so CPU inference is single-threaded.');
  if (caps.storageQuota != null && caps.storageQuota - (caps.storageUsage ?? 0) < MODELS.cpu.approxBytes * 1.05)
    caps.warnings.push('Browser storage quota may be too small for the model (needs 3.3–3.8 GB free).');
  return caps;
}
