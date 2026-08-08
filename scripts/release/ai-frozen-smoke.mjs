import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const executable = path.join(
  root, 'services', 'ai-engine', 'dist', 'jarvis-ai-engine',
  process.platform === 'win32' ? 'jarvis-ai-engine.exe' : 'jarvis-ai-engine',
);
const STARTUP_BUDGET_MS = 10_000;
const HEALTH_P95_BUDGET_MS = 250;
const IDLE_MEMORY_BUDGET_BYTES = 300 * 1024 * 1024;

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

async function request(port, token) {
  const started = performance.now();
  const response = await fetch(`http://127.0.0.1:${port}/v1/health`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    signal: AbortSignal.timeout(1_000),
  });
  const payload = await response.json().catch(() => null);
  return { status: response.status, payload, latencyMs: performance.now() - started };
}

async function runOnce(iteration) {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), `jarvis-frozen-smoke-${iteration}-`));
  const token = crypto.randomBytes(32).toString('base64url');
  const port = await reservePort();
  const started = performance.now();
  let output = '';
  const child = spawn(executable, [], {
    cwd: path.dirname(executable),
    env: {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      TEMP: process.env.TEMP,
      TMP: process.env.TMP,
      TMPDIR: process.env.TMPDIR,
      PYTHONUNBUFFERED: '1',
    },
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => { output = `${output}${chunk}`.slice(-20_000); });
  child.stderr.on('data', (chunk) => { output = `${output}${chunk}`.slice(-20_000); });
  child.stdin.end(`${JSON.stringify({
    token,
    port,
    buildSha: 'release-smoke',
    localAiRoot: path.join(tempRoot, '.local-ai'),
    localAiBaseUrl: 'http://127.0.0.1:65534',
  })}\n`);
  try {
    let health;
    while (performance.now() - started < STARTUP_BUDGET_MS) {
      if (child.exitCode !== null) throw new Error(`Frozen sidecar exited during startup (${child.exitCode}).`);
      try {
        const candidate = await request(port, token);
        if (candidate.status === 200) { health = candidate; break; }
      } catch { /* not ready */ }
      await delay(100);
    }
    if (!health) throw new Error('Frozen sidecar missed its startup budget.');
    const startupMs = performance.now() - started;
    const unauthorized = await request(port, null);
    if (unauthorized.status !== 401) throw new Error('Frozen sidecar health is not authenticated.');
    const samples = [];
    for (let index = 0; index < 20; index += 1) samples.push((await request(port, token)).latencyMs);
    samples.sort((left, right) => left - right);
    const p95 = samples[Math.ceil(samples.length * 0.95) - 1];
    const runtime = health.payload?.runtime ?? {};
    if (health.payload?.protocol !== 'jarvis.ai-engine/1' || health.payload?.buildSha !== 'release-smoke') {
      throw new Error('Frozen sidecar identity is incompatible.');
    }
    if (runtime.frozen !== true) throw new Error('Smoke test did not launch the frozen sidecar.');
    if (p95 > HEALTH_P95_BUDGET_MS) throw new Error(`Health p95 ${p95.toFixed(1)}ms exceeds budget.`);
    if (runtime.processPeakRssBytes != null && runtime.processPeakRssBytes > IDLE_MEMORY_BUDGET_BYTES) {
      throw new Error(`Idle RSS ${runtime.processPeakRssBytes} exceeds budget.`);
    }
    if (health.payload?.providers?.openai?.requiredToBoot !== false) throw new Error('OpenAI must not be required to boot.');
    if (output.includes(token)) throw new Error('Frozen sidecar emitted its bearer token.');
    return {
      startupMs: Math.round(startupMs * 10) / 10,
      healthP95Ms: Math.round(p95 * 10) / 10,
      processPeakRssBytes: runtime.processPeakRssBytes ?? null,
      python: health.payload?.python ?? null,
    };
  } catch (error) {
    const detail = output.replaceAll(token, '[REDACTED]').trim().slice(-2_000);
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${message}${detail ? ` Sidecar output: ${detail}` : ''}`, { cause: error });
  } finally {
    child.kill('SIGTERM');
    await Promise.race([
      new Promise((resolve) => child.once('exit', resolve)),
      delay(5_000).then(() => { if (child.exitCode === null) child.kill('SIGKILL'); }),
    ]);
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

const runs = [];
for (let iteration = 1; iteration <= 3; iteration += 1) runs.push(await runOnce(iteration));
const evidence = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  budgets: { startupMs: STARTUP_BUDGET_MS, healthP95Ms: HEALTH_P95_BUDGET_MS, idleMemoryBytes: IDLE_MEMORY_BUDGET_BYTES },
  runs,
  result: 'passed',
  openAIRequiredToBoot: false,
};
const evidenceDirectory = path.join(root, '.build', 'release-evidence');
mkdirSync(evidenceDirectory, { recursive: true, mode: 0o700 });
const target = path.join(evidenceDirectory, 'ai-smoke.json');
const temporary = `${target}.${process.pid}.tmp`;
writeFileSync(temporary, `${JSON.stringify(evidence, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
renameSync(temporary, target);
try { chmodSync(target, 0o600); } catch { /* Windows ACLs remain authoritative. */ }
console.log(`Frozen AI smoke passed: max startup ${Math.max(...runs.map((run) => run.startupMs))}ms, max health p95 ${Math.max(...runs.map((run) => run.healthP95Ms))}ms.`);
