import crypto from 'node:crypto';
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const outputDirectory = path.join(root, '.build', 'release-evidence');
const outputPath = path.join(outputDirectory, 'sbom.cdx.json');
const readJson = async (relative) => JSON.parse(await readFile(path.join(root, relative), 'utf8'));
const packageJson = await readJson('package.json');
const lock = await readJson('package-lock.json');
const chromeManifest = await readJson('chrome-extension/manifest.json');
const companionPackage = await readJson('apps/companion/package.json');

function packageName(lockPath, entry) {
  if (entry.name) return entry.name;
  return lockPath.split('node_modules/').at(-1) || lockPath;
}

function npmPurl(name, version) {
  const encoded = name.startsWith('@')
    ? `%40${name.slice(1).split('/').map(encodeURIComponent).join('/')}`
    : encodeURIComponent(name);
  return `pkg:npm/${encoded}@${encodeURIComponent(version)}`;
}

function license(value) {
  return value ? [{ license: { name: value } }] : [{ license: { name: 'NOASSERTION' } }];
}

const components = [];
const seen = new Set();
for (const [lockPath, entry] of Object.entries(lock.packages ?? {})) {
  if (!lockPath || entry.link || !entry.version) continue;
  const name = packageName(lockPath, entry);
  const bomRef = npmPurl(name, entry.version);
  if (seen.has(bomRef)) continue;
  seen.add(bomRef);
  components.push({
    type: 'library',
    'bom-ref': bomRef,
    group: name.startsWith('@') ? name.split('/')[0].slice(1) : undefined,
    name: name.startsWith('@') ? name.split('/')[1] : name,
    version: entry.version,
    purl: bomRef,
    licenses: license(entry.license),
    properties: [
      { name: 'jarvis:ecosystem', value: 'npm' },
      { name: 'jarvis:development', value: String(entry.dev === true) },
      ...(entry.optional ? [{ name: 'jarvis:optional', value: 'true' }] : []),
    ],
  });
}

const pythonLicenses = {
  fastapi: 'MIT', httpx: 'BSD-3-Clause', pydantic: 'MIT', uvicorn: 'BSD-3-Clause',
  pytest: 'MIT', 'pytest-asyncio': 'Apache-2.0', pyinstaller: 'GPL-2.0-or-later WITH Bootloader-exception',
  ruff: 'MIT', mypy: 'MIT',
};
for (const file of ['requirements-runtime.txt', 'requirements-dev.txt']) {
  const content = await readFile(path.join(root, 'services', 'ai-engine', file), 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const match = /^([A-Za-z0-9_.-]+)==([^\s]+)$/.exec(line.trim());
    if (!match) continue;
    const [, rawName, version] = match;
    const name = rawName.toLowerCase();
    const bomRef = `pkg:pypi/${encodeURIComponent(name)}@${encodeURIComponent(version)}`;
    if (seen.has(bomRef)) continue;
    seen.add(bomRef);
    components.push({
      type: 'library', 'bom-ref': bomRef, name, version, purl: bomRef,
      licenses: license(pythonLicenses[name]),
      properties: [
        { name: 'jarvis:ecosystem', value: 'pypi' },
        { name: 'jarvis:development', value: String(file === 'requirements-dev.txt' && !['fastapi', 'httpx', 'pydantic', 'uvicorn'].includes(name)) },
      ],
    });
  }
}

for (const component of [
  { name: 'Jarvis Companion', version: companionPackage.version, subtype: 'native-companion' },
  { name: 'Jarvis Chrome Control', version: chromeManifest.version, subtype: 'browser-extension' },
  { name: 'Jarvis AI Engine', version: '1.0.0', subtype: 'python-sidecar' },
]) {
  components.push({
    type: 'application',
    'bom-ref': `urn:jarvis:${component.subtype}:${component.version}`,
    name: component.name,
    version: component.version,
    properties: [{ name: 'jarvis:component-kind', value: component.subtype }],
  });
}

let gitSha = 'unknown';
try { gitSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(); } catch { /* source archive */ }
const lockHash = crypto.createHash('sha256').update(await readFile(path.join(root, 'package-lock.json'))).digest('hex');
const rootDependencies = Object.keys({ ...packageJson.dependencies, ...packageJson.devDependencies })
  .map((name) => {
    const version = lock.packages?.[`node_modules/${name}`]?.version;
    return version ? npmPurl(name, version) : null;
  }).filter(Boolean).sort();
const desktopRef = `pkg:npm/${packageJson.name}@${packageJson.version}`;
const sbom = {
  bomFormat: 'CycloneDX',
  specVersion: '1.6',
  serialNumber: `urn:uuid:${crypto.randomUUID()}`,
  version: 1,
  metadata: {
    timestamp: new Date().toISOString(),
    tools: { components: [{ type: 'application', name: 'Jarvis release evidence generator', version: '1' }] },
    component: { type: 'application', 'bom-ref': desktopRef, name: 'Jarvis', version: packageJson.version },
    properties: [
      { name: 'jarvis:git-sha', value: gitSha },
      { name: 'jarvis:package-lock-sha256', value: lockHash },
    ],
  },
  components: components.sort((left, right) => left['bom-ref'].localeCompare(right['bom-ref'])),
  dependencies: [{ ref: desktopRef, dependsOn: rootDependencies }],
};

await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
const temporary = `${outputPath}.${process.pid}.tmp`;
await writeFile(temporary, `${JSON.stringify(sbom, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
await rename(temporary, outputPath);
try { await chmod(outputPath, 0o600); } catch { /* Windows ACLs remain authoritative. */ }
console.log(`CycloneDX SBOM: ${path.relative(root, outputPath)} (${components.length} components)`);
