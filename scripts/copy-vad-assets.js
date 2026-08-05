/**
 * Copies the Silero VAD worklet/model and onnxruntime-web wasm runtime from
 * node_modules into public/vad/ so the renderer can load them without a CDN
 * (Electron has no network guarantees and we keep everything local).
 *
 * Runs on postinstall. Safe to re-run; overwrites stale copies.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DEST = path.join(ROOT, 'public', 'vad');

const ASSETS = [
  ['@ricky0123/vad-web/dist', 'vad.worklet.bundle.min.js'],
  ['@ricky0123/vad-web/dist', 'silero_vad_legacy.onnx'],
  ['@ricky0123/vad-web/dist', 'silero_vad_v5.onnx'],
  ['onnxruntime-web/dist', 'ort-wasm-simd-threaded.wasm'],
  ['onnxruntime-web/dist', 'ort-wasm-simd-threaded.mjs'],
];

function main() {
  fs.mkdirSync(DEST, { recursive: true });

  const missing = [];
  for (const [pkgDir, file] of ASSETS) {
    const src = path.join(ROOT, 'node_modules', pkgDir, file);
    if (!fs.existsSync(src)) {
      missing.push(path.join(pkgDir, file));
      continue;
    }
    fs.copyFileSync(src, path.join(DEST, file));
  }

  if (missing.length > 0) {
    console.error(`[copy-vad-assets] Missing source files: ${missing.join(', ')}`);
    process.exit(1);
  }
  console.log(`[copy-vad-assets] Copied ${ASSETS.length} files to public/vad/`);
}

main();
