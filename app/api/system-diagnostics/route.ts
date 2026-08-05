import { NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';
import { execFileSync } from 'child_process';
import { getDeskflowStatus } from '@/backend/deskflow/config';

function readJsonFile(filePath: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function remoteClientDiagnostics() {
  const extensionPath = process.env.JARVIS_CHROME_EXTENSION_PATH && path.isAbsolute(process.env.JARVIS_CHROME_EXTENSION_PATH)
    ? process.env.JARVIS_CHROME_EXTENSION_PATH
    : path.join(process.cwd(), 'chrome-extension');
  const extensionManifestPath = path.join(extensionPath, 'manifest.json');
  const extensionProtocolPath = path.join(extensionPath, 'remote-protocol.json');
  const extensionManifest = readJsonFile(extensionManifestPath);
  const extensionProtocol = readJsonFile(extensionProtocolPath);
  const companionPackagePath = path.join(process.cwd(), 'apps', 'companion', 'package.json');
  const companionPackage = readJsonFile(companionPackagePath);
  const aiSessionPath = path.join(process.env.JARVIS_DATA_DIR || process.cwd(), 'jarvis-ai-engine-session.json');
  let aiSessionPrivate: boolean | null = null;
  try { aiSessionPrivate = process.platform === 'win32' || (fs.statSync(aiSessionPath).mode & 0o077) === 0; } catch { /* unavailable */ }
  return {
    remoteProtocol: extensionProtocol?.protocol ?? null,
    chrome: {
      path: extensionPath,
      manifestExists: fs.existsSync(extensionManifestPath),
      manifestVersion: extensionManifest?.manifest_version ?? null,
      extensionVersion: extensionManifest?.version ?? null,
      protocolDescriptorExists: fs.existsSync(extensionProtocolPath),
    },
    companion: {
      workspaceExists: fs.existsSync(companionPackagePath),
      version: companionPackage?.version ?? null,
      sourceServerExists: fs.existsSync(path.join(process.cwd(), 'apps', 'companion', 'server.cjs')),
      packagedMacAppExists: fs.existsSync(path.join(process.cwd(), 'apps', 'companion', 'dist', 'mac-arm64', 'Jarvis Companion.app')),
      packagedWindowsAppExists: fs.existsSync(path.join(process.cwd(), 'apps', 'companion', 'dist', 'win-unpacked', 'Jarvis Companion.exe')),
    },
    aiEngineSession: { present: fs.existsSync(aiSessionPath), privatePermissions: aiSessionPrivate },
  };
}

function releaseArtifactDiagnostics() {
  const manifestPath = process.env.JARVIS_ARTIFACT_MANIFEST_PATH && path.isAbsolute(process.env.JARVIS_ARTIFACT_MANIFEST_PATH)
    ? process.env.JARVIS_ARTIFACT_MANIFEST_PATH
    : path.join(process.cwd(), '.build', 'release-evidence', 'artifact-manifest.json');
  const sbomPath = process.env.JARVIS_SBOM_PATH && path.isAbsolute(process.env.JARVIS_SBOM_PATH)
    ? process.env.JARVIS_SBOM_PATH
    : path.join(process.cwd(), '.build', 'release-evidence', 'sbom.cdx.json');
  const aiEnginePath = process.env.JARVIS_AI_ENGINE_RESOURCE_PATH && path.isAbsolute(process.env.JARVIS_AI_ENGINE_RESOURCE_PATH)
    ? process.env.JARVIS_AI_ENGINE_RESOURCE_PATH
    : null;
  const manifest = readJsonFile(manifestPath);
  const application = manifest?.application && typeof manifest.application === 'object'
    ? manifest.application as Record<string, unknown>
    : null;
  const source = manifest?.source && typeof manifest.source === 'object'
    ? manifest.source as Record<string, unknown>
    : null;
  return {
    manifestPresent: fs.existsSync(manifestPath),
    sbomPresent: fs.existsSync(sbomPath),
    identity: manifest ? {
      schemaVersion: manifest.schemaVersion ?? null,
      appVersion: application?.version ?? null,
      gitSha: source?.gitSha ?? null,
      dirty: source?.dirty ?? null,
      protocols: manifest.protocols ?? null,
      database: manifest.database ?? null,
      runtimes: manifest.runtimes ?? null,
      models: manifest.models ?? null,
    } : null,
    resources: {
      chromeExtension: fs.existsSync(process.env.JARVIS_CHROME_EXTENSION_PATH || path.join(process.cwd(), 'chrome-extension')),
      aiEngine: aiEnginePath ? fs.existsSync(aiEnginePath) : false,
      sbom: fs.existsSync(sbomPath),
    },
  };
}

function normalizeWindowsCmdPath(raw: string): string {
  return raw.trim().replace(/^["']+|["']+$/g, '');
}

function listWindowsCmdCandidates(): string[] {
  const candidates: string[] = [];
  const com = process.env.ComSpec && normalizeWindowsCmdPath(process.env.ComSpec);
  if (com && !/%[^%]+%/.test(com)) {
    candidates.push(com);
  }
  const root = process.env.SystemRoot || process.env.windir || '';
  const normalizedRoot = root && !/%[^%]+%/.test(root) ? root : '';
  if (normalizedRoot) {
    candidates.push(
      path.join(normalizedRoot, 'System32', 'cmd.exe'),
      path.join(normalizedRoot, 'Sysnative', 'cmd.exe')
    );
  }
  candidates.push('C:\\Windows\\System32\\cmd.exe', 'C:\\Windows\\Sysnative\\cmd.exe');
  return candidates;
}

function firstExistingCmd(): string | null {
  for (const p of listWindowsCmdCandidates()) {
    if (p && fs.existsSync(p)) return p;
  }
  return null;
}

function winChildEnv(): NodeJS.ProcessEnv {
  const base = process.env.Path || process.env.PATH || '';
  const merged = [
    base,
    'C:\\Windows\\System32',
    'C:\\Windows',
    'C:\\Windows\\System32\\Wbem',
    'C:\\Windows\\System32\\WindowsPowerShell\\v1.0',
  ]
    .filter(Boolean)
    .join(';');
  return { ...process.env, Path: merged, PATH: merged };
}

function probePython(): { ok: boolean; via: string | null; detail: string } {
  if (process.platform !== 'win32') {
    for (const cmd of ['python3', 'python']) {
      try {
        const v = execFileSync(cmd, ['--version'], {
          timeout: 4000,
          stdio: ['ignore', 'pipe', 'pipe'],
        }).toString().trim();
        return { ok: true, via: cmd, detail: v };
      } catch {
        /* next */
      }
    }
    return { ok: false, via: null, detail: 'No python3/python on PATH' };
  }

  const env = winChildEnv();
  for (const args of [['py', ['-3', '--version']], ['python', ['--version']], ['python3', ['--version']]] as const) {
    try {
      const v = execFileSync(args[0], args[1], {
        timeout: 4000,
        stdio: ['ignore', 'pipe', 'pipe'],
        env,
      })
        .toString()
        .trim();
      return { ok: true, via: args[0], detail: v };
    } catch {
      /* next */
    }
  }
  return { ok: false, via: null, detail: 'No py -3, python, or python3 found (try a Python path override in Settings → System)' };
}

function probeMacAccessibility(): { available: boolean; granted: boolean; detail: string } {
  if (process.platform !== 'darwin') {
    return { available: false, granted: false, detail: 'macOS only' };
  }

  try {
    const probeResult = execFileSync(
      '/usr/bin/osascript',
      [
        '-e',
        `tell application "System Events"
  set frontApp to first application process whose frontmost is true
  set frontName to name of frontApp
  set uiElementCount to count of UI elements of frontApp
  return frontName & "||" & (uiElementCount as text)
end tell`,
      ],
      { timeout: 4000, stdio: ['ignore', 'pipe', 'pipe'] }
    ).toString().trim();
    const [frontmostApp, uiElementCount = '0'] = probeResult.split('||');
    return {
      available: true,
      granted: frontmostApp.length > 0,
      detail: frontmostApp
        ? `Accessibility UI query succeeded (frontmost app: ${frontmostApp}, UI elements: ${uiElementCount})`
        : 'Accessibility UI query returned no application',
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { available: true, granted: false, detail };
  }
}

export async function GET() {
  const SCRIPTS_DIR = path.join(process.cwd(), 'scripts');
  const binaryName = process.platform === 'win32' ? 'computer_use.exe' : 'computer_use';
  const BINARY_PATH = path.join(SCRIPTS_DIR, 'dist', binaryName);
  const SCRIPT_PATH = path.join(SCRIPTS_DIR, 'computer_use.py');

  const isWin = process.platform === 'win32' || process.env.OS === 'Windows_NT';
  let shellResolved: string | null = null;
  if (isWin) {
    shellResolved = firstExistingCmd();
  } else {
    for (const sh of ['/bin/zsh', '/bin/bash', '/bin/sh']) {
      if (fs.existsSync(sh)) {
        shellResolved = sh;
        break;
      }
    }
  }

  const python = probePython();

  return NextResponse.json({
    platform: process.platform,
    arch: process.arch,
    cwd: process.cwd(),
    pathEnvSet: !!(process.env.Path || process.env.PATH),
    shell: {
      resolvedPath: shellResolved,
      exists: !!(shellResolved && fs.existsSync(shellResolved)),
      candidatesTried: isWin ? listWindowsCmdCandidates() : ['/bin/zsh', '/bin/bash', '/bin/sh'],
    },
    computerUse: {
      scriptsDir: SCRIPTS_DIR,
      scriptsDirExists: fs.existsSync(SCRIPTS_DIR),
      scriptPath: SCRIPT_PATH,
      scriptExists: fs.existsSync(SCRIPT_PATH),
      binaryPath: BINARY_PATH,
      binaryExists: fs.existsSync(BINARY_PATH),
    },
    deskflow: getDeskflowStatus(),
    macAccessibility: probeMacAccessibility(),
    python,
    remoteClients: remoteClientDiagnostics(),
    releaseArtifact: releaseArtifactDiagnostics(),
  });
}
