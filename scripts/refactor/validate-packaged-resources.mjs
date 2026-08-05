import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const errors = [];
const readJson = async (relative) => JSON.parse(await readFile(path.join(root, relative), 'utf8'));

async function directorySize(directory) {
  let size = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    size += entry.isDirectory() ? await directorySize(absolute) : (await stat(absolute)).size;
  }
  return size;
}

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
    path.join('.next', 'standalone', 'server.js'),
    path.join('.build', 'release-evidence', 'artifact-manifest.json'),
    path.join('.build', 'release-evidence', 'sbom.cdx.json'),
  ]) {
    try { await stat(path.join(root, relative)); } catch { errors.push(`Built resource ${relative} is missing.`); }
  }

  const standalone = path.join(root, '.next', 'standalone');
  const allowedTopLevel = new Set(['.next', 'node_modules', 'package.json', 'public', 'scripts', 'server.js']);
  try {
    const unexpected = (await readdir(standalone)).filter((entry) => !allowedTopLevel.has(entry));
    if (unexpected.length) errors.push(`Standalone runtime contains unexpected top-level entries: ${unexpected.join(', ')}.`);
    const size = await directorySize(standalone);
    if (size > 250 * 1024 * 1024) errors.push(`Standalone runtime is ${(size / 1024 / 1024).toFixed(1)} MiB; limit is 250 MiB.`);
  } catch {
    errors.push('Standalone runtime could not be inspected.');
  }
}

if (errors.length) {
  console.error('Packaged resource validation failed:');
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(`Packaged resources conform to remote protocol ${protocol.protocol}.`);
}
