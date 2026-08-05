import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const errors = [];
const readJson = async (relative) => JSON.parse(await readFile(path.join(root, relative), 'utf8'));

const protocol = await readJson('packages/contracts/remote-protocol.json');
const chromeProtocol = await readJson('chrome-extension/remote-protocol.json');
const companionProtocol = await readJson('apps/companion/remote-protocol.json');
const chromeManifest = await readJson('chrome-extension/manifest.json');
const companionPackage = await readJson('apps/companion/package.json');

if (JSON.stringify(chromeProtocol) !== JSON.stringify(protocol)) errors.push('Chrome remote protocol descriptor has drifted.');
if (JSON.stringify(companionProtocol) !== JSON.stringify(protocol)) errors.push('Companion remote protocol descriptor has drifted.');
if (chromeManifest.manifest_version !== 3) errors.push('Chrome extension must use Manifest V3.');
if (!/^\d+\.\d+\.\d+$/.test(chromeManifest.version)) errors.push('Chrome extension version must be semver-compatible.');
if (chromeManifest.background?.service_worker !== 'background.js') errors.push('Chrome background service worker is missing.');
if (!Array.isArray(chromeManifest.optional_host_permissions) || !chromeManifest.optional_host_permissions.includes('https://*/*')) {
  errors.push('Chrome per-origin optional HTTPS permissions are missing.');
}
if (!Array.isArray(companionPackage.workspaces) && companionPackage.name !== 'jarvis-companion') {
  errors.push('Companion workspace metadata is invalid.');
}
for (const required of ['app.cjs', 'server.cjs', 'result-ledger.cjs', 'remote-protocol.json']) {
  if (!companionPackage.build?.files?.includes(required)) errors.push(`Companion package omits ${required}.`);
}
for (const relative of [
  'chrome-extension/background.js',
  'chrome-extension/popup.html',
  'apps/companion/app.cjs',
  'apps/companion/server.cjs',
  'services/ai-engine/entrypoint.py',
]) {
  try {
    if (!(await stat(path.join(root, relative))).isFile()) errors.push(`${relative} is not a file.`);
  } catch {
    errors.push(`${relative} is missing.`);
  }
}

if (process.argv.includes('--require-built')) {
  const aiExecutable = process.platform === 'win32' ? 'jarvis-ai-engine.exe' : 'jarvis-ai-engine';
  for (const relative of [
    path.join('services', 'ai-engine', 'dist', 'jarvis-ai-engine', aiExecutable),
    path.join('dist-electron', 'main.js'),
  ]) {
    try { await stat(path.join(root, relative)); } catch { errors.push(`Built resource ${relative} is missing.`); }
  }
}

if (errors.length) {
  console.error('Packaged resource validation failed:');
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(`Packaged resources conform to remote protocol ${protocol.protocol}.`);
}
