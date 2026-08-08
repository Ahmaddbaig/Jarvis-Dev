import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AIEngineSupervisor } from '../apps/desktop/src/ai-engine-supervisor';
import { requestAIEngine } from '../backend/ai-engine/client';

const originalDataDir = process.env.JARVIS_DATA_DIR;
const temporaryDirectories: string[] = [];

// This spawns the real AI engine out of services/ai-engine/.venv. Without the
// guard, `npm test` fails for anyone who has not run `npm run ai:setup`.
const enginePython = path.join(
  process.cwd(), 'services', 'ai-engine', '.venv',
  process.platform === 'win32' ? 'Scripts' : 'bin',
  process.platform === 'win32' ? 'python.exe' : 'python',
);
const describeWithEngine = fs.existsSync(enginePython) ? describe : describe.skip;

afterEach(() => {
  if (originalDataDir === undefined) delete process.env.JARVIS_DATA_DIR;
  else process.env.JARVIS_DATA_DIR = originalDataDir;
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describeWithEngine('AI engine supervision', () => {
  it('verifies a token-authenticated sidecar and wipes the ephemeral session on stop', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-ai-engine-test-'));
    temporaryDirectories.push(dataDir);
    process.env.JARVIS_DATA_DIR = dataDir;
    const supervisor = new AIEngineSupervisor({
      isPackaged: false,
      appPath: process.cwd(),
      resourcesPath: process.cwd(),
      dataDir,
      localAIRoot: path.join(dataDir, '.local-ai'),
      buildSha: 'vitest-build',
    });

    try {
      const status = await supervisor.start();
      expect(status).toMatchObject({ state: 'ready', protocol: 'jarvis.ai-engine/1', buildSha: 'vitest-build' });
      expect(JSON.stringify(status)).not.toContain('token');
      const descriptorPath = path.join(dataDir, 'jarvis-ai-engine-session.json');
      expect(fs.existsSync(descriptorPath)).toBe(true);
      if (process.platform !== 'win32') expect(fs.statSync(descriptorPath).mode & 0o077).toBe(0);

      const health = await requestAIEngine<{ ok: boolean; buildSha: string }>('/v1/health');
      expect(health).toMatchObject({ ok: true, buildSha: 'vitest-build' });
    } finally {
      await supervisor.stop();
    }
    expect(fs.existsSync(path.join(dataDir, 'jarvis-ai-engine-session.json'))).toBe(false);
  }, 30_000);
});
