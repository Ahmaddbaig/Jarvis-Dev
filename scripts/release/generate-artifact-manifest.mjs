import crypto from 'node:crypto';
import { createReadStream } from 'node:fs';
import { chmod, mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { execFileSync, spawnSync } from 'node:child_process';

const root = process.cwd();
const evidenceDirectory = path.join(root, '.build', 'release-evidence');
const outputPath = path.join(evidenceDirectory, 'artifact-manifest.json');
const requireBuilt = process.argv.includes('--require-built');

const readJson = async (relative) => JSON.parse(await readFile(path.join(root, relative), 'utf8'));
const relativePath = (absolute) => path.relative(root, absolute).split(path.sep).join('/');

async function exists(relative) {
  try { return (await stat(path.join(root, relative))).isFile(); } catch { return false; }
}

async function sha256(absolute) {
  const hash = crypto.createHash('sha256');
  await new Promise((resolve, reject) => {
    const stream = createReadStream(absolute);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.once('end', resolve);
    stream.once('error', reject);
  });
  return hash.digest('hex');
}

function command(commandName, args, fallback = 'unknown') {
  try { return execFileSync(commandName, args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { return fallback; }
}

function pythonVersion() {
  const candidates = process.platform === 'win32'
    ? [[path.join(root, 'services', 'ai-engine', '.venv', 'Scripts', 'python.exe'), []], ['python', []], ['py', ['-3']]]
    : [[path.join(root, 'services', 'ai-engine', '.venv', 'bin', 'python'), []], ['python3', []], ['python', []]];
  for (const [executable, prefix] of candidates) {
    const result = spawnSync(executable, [...prefix, '--version'], { encoding: 'utf8' });
    if (result.status === 0) return `${result.stdout}${result.stderr}`.trim().replace(/^Python\s+/, '');
  }
  return 'unavailable';
}

function electronVersions() {
  const executable = process.platform === 'darwin'
    ? path.join(root, 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron')
    : path.join(root, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron');
  const result = spawnSync(executable, ['-e', 'process.stdout.write(JSON.stringify(process.versions))'], {
    encoding: 'utf8',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  });
  if (result.status !== 0) return {};
  try { return JSON.parse(result.stdout); } catch { return {}; }
}

async function collectInstallers(directory, depth = 0) {
  if (depth > 3) return [];
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); } catch { return []; }
  const results = [];
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) results.push(...await collectInstallers(absolute, depth + 1));
    else if (/\.(?:dmg|zip|exe|msi|AppImage|deb|rpm|blockmap)$/i.test(entry.name)) results.push(absolute);
  }
  return results;
}

const packageJson = await readJson('package.json');
const packageLock = await readJson('package-lock.json');
const remoteProtocol = await readJson('packages/contracts/remote-protocol.json');
const chromeManifest = await readJson('chrome-extension/manifest.json');
const companionPackage = await readJson('apps/companion/package.json');
const migrationsSource = await readFile(path.join(root, 'packages', 'persistence', 'src', 'migrations.ts'), 'utf8');
const migrationSection = migrationsSource.slice(migrationsSource.indexOf('export const DATABASE_MIGRATIONS'));
const schemaVersions = [...migrationSection.matchAll(/\bid:\s*(\d+),/g)].map((match) => Number(match[1]));
const profiles = await Promise.all(['m2', 'm3', 'm5'].map((profile) => readJson(`services/ai-engine/profiles/${profile}.json`)));
const runtimeRequirements = (await readFile(path.join(root, 'services', 'ai-engine', 'requirements-runtime.txt'), 'utf8'))
  .split(/\r?\n/).filter((line) => line && !line.startsWith('#'));

const executable = process.platform === 'win32' ? 'jarvis-ai-engine.exe' : 'jarvis-ai-engine';
const resources = [
  { path: 'dist-electron/main.js', requiredForBuild: true },
  { path: '.next/standalone/server.js', requiredForBuild: true },
  { path: `services/ai-engine/dist/jarvis-ai-engine/${executable}`, requiredForBuild: true },
  { path: 'packages/contracts/remote-protocol.json', requiredForBuild: true },
  { path: 'chrome-extension/remote-protocol.json', requiredForBuild: true },
  { path: 'apps/companion/remote-protocol.json', requiredForBuild: true },
  { path: 'chrome-extension/manifest.json', requiredForBuild: true },
  { path: 'apps/companion/package.json', requiredForBuild: true },
  { path: '.build/release-evidence/ai-smoke.json', requiredForBuild: false },
  { path: '.build/release-evidence/standalone-smoke.json', requiredForBuild: false },
  { path: '.build/release-evidence/desktop-package-smoke.json', requiredForBuild: false },
];
for (const resource of resources) {
  resource.exists = await exists(resource.path);
  if (resource.exists) resource.sha256 = await sha256(path.join(root, resource.path));
}
const missing = resources.filter((resource) => resource.requiredForBuild && !resource.exists);
if (requireBuilt && missing.length) {
  throw new Error(`Release evidence is missing built resources: ${missing.map((item) => item.path).join(', ')}`);
}

const installerPaths = [
  ...await collectInstallers(path.join(root, 'release')),
  ...await collectInstallers(path.join(root, 'apps', 'companion', 'dist')),
];
const installers = await Promise.all(installerPaths.sort().map(async (absolute) => ({
  path: relativePath(absolute),
  size: (await stat(absolute)).size,
  sha256: await sha256(absolute),
})));

const gitSha = command('git', ['rev-parse', 'HEAD']);
const gitStatus = command('git', ['status', '--porcelain'], '');
const embeddedVersions = electronVersions();
const generatedAt = process.env.SOURCE_DATE_EPOCH
  ? new Date(Number(process.env.SOURCE_DATE_EPOCH) * 1000).toISOString()
  : new Date().toISOString();
const manifest = {
  schemaVersion: 1,
  generatedAt,
  application: { name: packageJson.name, productName: 'Jarvis', version: packageJson.version },
  source: { gitSha, dirty: gitStatus.length > 0 },
  protocols: {
    core: 1,
    remote: remoteProtocol.protocol,
    aiEngine: 'jarvis.ai-engine/1',
  },
  database: { schemaVersion: Math.max(0, ...schemaVersions) },
  runtimes: {
    node: embeddedVersions.node ?? 'unknown',
    buildNode: process.version.replace(/^v/, ''),
    electron: packageLock.packages?.['node_modules/electron']?.version ?? packageJson.devDependencies?.electron ?? 'unknown',
    chromium: embeddedVersions.chrome ?? 'unknown',
    python: pythonVersion(),
    pythonTarget: '3.12',
    pythonPackages: runtimeRequirements,
  },
  clients: {
    chrome: { version: chromeManifest.version, manifestVersion: chromeManifest.manifest_version },
    companion: { version: companionPackage.version },
  },
  models: {
    manifestSchemaVersion: 1,
    profiles: profiles.map((profile) => ({ id: profile.id, manifestId: profile.manifestId })),
    directoriesManagedSeparately: true,
  },
  releasePolicy: {
    signatureRequiredForDistribution: true,
    migrationBackupRequired: true,
    stagedRolloutRequired: true,
    preserveModelDirectories: true,
    lastKnownGoodRequired: true,
  },
  resources,
  installers,
};

await mkdir(evidenceDirectory, { recursive: true, mode: 0o700 });
const temporary = `${outputPath}.${process.pid}.tmp`;
await writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
await rename(temporary, outputPath);
try { await chmod(outputPath, 0o600); } catch { /* Windows ACLs remain authoritative. */ }
console.log(`Release artifact manifest: ${relativePath(outputPath)} (${resources.filter((item) => item.exists).length} resources, ${installers.length} installers)`);
