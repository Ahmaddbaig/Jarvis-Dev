import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const standaloneRoot = path.join(root, '.next', 'standalone');
const serverPath = path.join(standaloneRoot, 'server.js');
const token = 'S'.repeat(43);

function releaseEnvironment() {
  const environment = { ...process.env };
  for (const name of Object.keys(environment)) {
    if (/(?:TOKEN|SECRET|PASSWORD|API_KEY|PRIVATE_KEY)$/i.test(name)) delete environment[name];
  }
  return environment;
}

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') return server.close(() => reject(new Error('No loopback port.')));
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const dataDirectory = mkdtempSync(path.join(os.tmpdir(), 'jarvis-standalone-smoke-'));
const port = await reservePort();
let output = '';
const started = performance.now();
const child = spawn(process.execPath, [serverPath], {
  cwd: standaloneRoot,
  env: {
    ...releaseEnvironment(),
    NODE_ENV: 'production',
    HOSTNAME: '127.0.0.1',
    PORT: String(port),
    JARVIS_DATA_DIR: dataDirectory,
    JARVIS_DESKTOP_TOKEN: token,
    JARVIS_APP_VERSION: 'release-smoke',
    JARVIS_ARTIFACT_MANIFEST_PATH: path.join(root, '.build', 'release-evidence', 'artifact-manifest.json'),
    JARVIS_SBOM_PATH: path.join(root, '.build', 'release-evidence', 'sbom.cdx.json'),
    JARVIS_AI_ENGINE_RESOURCE_PATH: path.join(
      root, 'services', 'ai-engine', 'dist', 'jarvis-ai-engine',
      process.platform === 'win32' ? 'jarvis-ai-engine.exe' : 'jarvis-ai-engine',
    ),
  },
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'],
});
child.stdout.on('data', (chunk) => { output = `${output}${chunk}`.slice(-20_000); });
child.stderr.on('data', (chunk) => { output = `${output}${chunk}`.slice(-20_000); });

try {
  let rootResponse;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Standalone server exited during startup (${child.exitCode}).`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) { rootResponse = response; break; }
    } catch { /* not ready */ }
    await delay(100);
  }
  if (!rootResponse) throw new Error('Standalone server missed its 10-second startup budget.');
  const diagnosticsResponse = await fetch(`http://127.0.0.1:${port}/api/system-diagnostics`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(5_000),
  });
  if (!diagnosticsResponse.ok) throw new Error(`Diagnostics returned HTTP ${diagnosticsResponse.status}.`);
  const diagnostics = await diagnosticsResponse.json();
  if (diagnostics.releaseArtifact?.manifestPresent !== true || diagnostics.releaseArtifact?.sbomPresent !== true) {
    throw new Error('Standalone diagnostics did not expose packaged release identity.');
  }
  if (diagnostics.computerUse?.binaryExists !== true) throw new Error('Standalone frozen computer-use helper is missing.');
  const startupMs = performance.now() - started;
  const evidence = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    startupMs: Math.round(startupMs * 10) / 10,
    result: 'passed',
    diagnosticsIdentityPresent: true,
    openAIKeyProvided: false,
  };
  const evidenceDirectory = path.join(root, '.build', 'release-evidence');
  mkdirSync(evidenceDirectory, { recursive: true, mode: 0o700 });
  const target = path.join(evidenceDirectory, 'standalone-smoke.json');
  const temporary = `${target}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(evidence, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  renameSync(temporary, target);
  console.log(`Standalone release smoke passed in ${evidence.startupMs}ms.`);
} catch (error) {
  const safeOutput = output.replaceAll(token, '[REDACTED]').trim().slice(-2_000);
  const message = error instanceof Error ? error.message : String(error);
  throw new Error(`${message}${safeOutput ? ` Server output: ${safeOutput}` : ''}`, { cause: error });
} finally {
  child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    delay(5_000).then(() => { if (child.exitCode === null) child.kill('SIGKILL'); }),
  ]);
  rmSync(dataDirectory, { recursive: true, force: true });
}
