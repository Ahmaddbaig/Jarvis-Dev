import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const candidates = process.platform === 'win32'
  ? [path.join(root, 'release', 'win-unpacked', 'Jarvis.exe')]
  : process.platform === 'darwin'
    ? [path.join(root, 'release', 'mac-arm64', 'Jarvis.app', 'Contents', 'MacOS', 'Jarvis')]
    : [path.join(root, 'release', 'linux-unpacked', 'jarvis')];
const executable = candidates.find(existsSync);
if (!executable) throw new Error(`Packaged desktop executable is missing for ${process.platform}.`);

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
const dataDirectory = mkdtempSync(path.join(os.tmpdir(), 'jarvis-desktop-package-smoke-'));
const token = 'P'.repeat(43);
const port = await reservePort();
const httpsPort = await reservePort();
let output = '';
const started = performance.now();
const child = spawn(executable, [], {
  env: {
    ...releaseEnvironment(),
    JARVIS_RELEASE_SMOKE: '1',
    JARVIS_DATA_DIR: dataDirectory,
    JARVIS_DESKTOP_TOKEN: token,
    JARVIS_PORT: String(port),
    JARVIS_HTTPS_PORT: String(httpsPort),
    JARVIS_BUILD_SHA: 'packaged-release-smoke',
  },
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'],
});
child.stdout.on('data', (chunk) => { output = `${output}${chunk}`.slice(-40_000); });
child.stderr.on('data', (chunk) => { output = `${output}${chunk}`.slice(-40_000); });

try {
  let ready = false;
  for (let attempt = 0; attempt < 300; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Packaged desktop exited during startup (${child.exitCode}).`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) { ready = true; break; }
    } catch { /* not ready */ }
    await delay(100);
  }
  if (!ready) throw new Error('Packaged desktop missed its 30-second startup budget.');
  const startupMs = performance.now() - started;
  const headers = { Authorization: `Bearer ${token}` };
  const diagnosticsResponse = await fetch(`http://127.0.0.1:${port}/api/system-diagnostics`, {
    headers,
    signal: AbortSignal.timeout(5_000),
  });
  const diagnostics = await diagnosticsResponse.json();
  if (!diagnosticsResponse.ok) throw new Error(`Packaged diagnostics returned HTTP ${diagnosticsResponse.status}.`);
  if (diagnostics.releaseArtifact?.manifestPresent !== true || diagnostics.releaseArtifact?.sbomPresent !== true) {
    throw new Error('Packaged release identity or SBOM is unavailable.');
  }
  if (diagnostics.releaseArtifact?.resources?.aiEngine !== true || diagnostics.releaseArtifact?.resources?.chromeExtension !== true) {
    throw new Error('Packaged AI or Chrome resources are unavailable.');
  }
  const aiResponse = await fetch(`http://127.0.0.1:${port}/api/ai-engine/health`, {
    headers,
    signal: AbortSignal.timeout(5_000),
  });
  const ai = await aiResponse.json();
  if (!aiResponse.ok || ai.protocol !== 'jarvis.ai-engine/1' || ai.buildSha !== 'packaged-release-smoke') {
    throw new Error('Packaged supervised AI engine is incompatible.');
  }
  writeFileSync(path.join(dataDirectory, 'jarvis-release-smoke-stop'), 'stop\n', { encoding: 'utf8', mode: 0o600 });
  const exited = await Promise.race([
    new Promise((resolve) => child.once('exit', () => resolve(true))),
    delay(15_000).then(() => false),
  ]);
  if (!exited) throw new Error('Packaged desktop did not shut down gracefully.');
  if (existsSync(path.join(dataDirectory, 'jarvis-ai-engine-session.json'))) {
    throw new Error('Packaged desktop left an AI session descriptor after shutdown.');
  }
  const evidence = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    startupMs: Math.round(startupMs * 10) / 10,
    result: 'passed',
    identityPresent: true,
    aiProtocol: ai.protocol,
    gracefulShutdown: true,
    sessionDescriptorRemoved: true,
    openAIKeyProvided: false,
  };
  const evidenceDirectory = path.join(root, '.build', 'release-evidence');
  mkdirSync(evidenceDirectory, { recursive: true, mode: 0o700 });
  const target = path.join(evidenceDirectory, 'desktop-package-smoke.json');
  const temporary = `${target}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(evidence, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  renameSync(temporary, target);
  console.log(`Packaged desktop smoke passed with graceful shutdown in ${evidence.startupMs}ms.`);
} catch (error) {
  const safeOutput = output.replaceAll(token, '[REDACTED]').trim().slice(-4_000);
  const message = error instanceof Error ? error.message : String(error);
  throw new Error(`${message}${safeOutput ? ` Desktop output: ${safeOutput}` : ''}`, { cause: error });
} finally {
  if (child.exitCode === null) child.kill('SIGKILL');
  rmSync(dataDirectory, { recursive: true, force: true });
}
