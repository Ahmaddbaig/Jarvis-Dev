import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

export const DESKFLOW_DIRECTIONS = ['left', 'right', 'up', 'down'] as const;
export type DeskflowDirection = (typeof DESKFLOW_DIRECTIONS)[number];

export interface DeskflowLink {
  target: string;
  sourceRange: [number, number];
  targetRange: [number, number];
}

export interface DeskflowEdge {
  direction: DeskflowDirection;
  start: number;
  end: number;
  position: number;
}

export interface DeskflowTopology {
  configPath: string | null;
  primaryScreen: string | null;
  screens: string[];
  links: Record<string, Partial<Record<DeskflowDirection, DeskflowLink[]>>>;
  switchDelayMs: number;
  switchDoubleTapMs: number;
}

export interface DeskflowStatus extends DeskflowTopology {
  installed: boolean;
  running: boolean;
  serverMode: boolean;
  establishedPeerCount: number;
  connectedScreens: string[];
  switchAvailable: boolean;
  switchReason: string | null;
}

function firstExisting(paths: string[]): string | null {
  return paths.find((candidate) => fs.existsSync(candidate)) ?? null;
}

function guiSettingsCandidates(): string[] {
  const home = os.homedir();
  if (process.platform === 'darwin') {
    return [
      path.join(home, 'Library', 'Deskflow', 'Deskflow.conf'),
      path.join('/Library', 'Deskflow', 'Deskflow.conf'),
    ];
  }
  if (process.platform === 'win32') {
    return [
      path.join(process.env.APPDATA ?? '', 'Deskflow', 'Deskflow.conf'),
      path.join(process.env.PROGRAMDATA ?? 'C:\\ProgramData', 'Deskflow', 'Deskflow.conf'),
    ].filter(Boolean);
  }
  return [
    path.join(process.env.XDG_CONFIG_HOME ?? path.join(home, '.config'), 'Deskflow', 'Deskflow.conf'),
    path.join('/etc', 'Deskflow', 'Deskflow.conf'),
  ];
}

function serverConfigCandidates(guiPath: string | null): string[] {
  const explicit = process.env.JARVIS_DESKFLOW_CONFIG?.trim();
  const candidates = [
    explicit ?? '',
    guiPath ? path.join(path.dirname(guiPath), 'deskflow-server.conf') : '',
  ];
  if (process.platform === 'win32') {
    candidates.push(path.join(process.env.PROGRAMDATA ?? 'C:\\ProgramData', 'Deskflow', 'deskflow-server.conf'));
  }
  return candidates.filter(Boolean);
}

function stripComment(line: string): string {
  return line.replace(/#.*$/, '').trim();
}

function parseLinkEndpoint(value: string): { name: string; range: [number, number] } | null {
  const match = value.trim().match(
    /^([^()]+?)(?:\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*\))?$/
  );
  if (!match) return null;
  const name = match[1].trim();
  const start = match[2] === undefined ? 0 : Number(match[2]);
  const end = match[3] === undefined ? 100 : Number(match[3]);
  if (!name || !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end > 100 || start >= end) {
    return null;
  }
  return { name, range: [start, end] };
}

function parsePrimaryScreen(guiContent: string): { name: string | null; serverMode: boolean } {
  let section = '';
  let name: string | null = null;
  let serverMode = false;
  for (const rawLine of guiContent.split(/\r?\n/)) {
    const line = rawLine.trim();
    const sectionMatch = line.match(/^\[([^\]]+)]$/);
    if (sectionMatch) {
      section = sectionMatch[1];
      continue;
    }
    if (section !== 'core') continue;
    const separator = line.indexOf('=');
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (key === 'computerName' && value) name = value;
    if (key === 'coreMode') serverMode = value === '2';
  }
  return { name, serverMode };
}

export function parseDeskflowServerConfig(content: string, configPath: string | null = null): DeskflowTopology {
  const screens: string[] = [];
  const links: Record<string, Partial<Record<DeskflowDirection, DeskflowLink[]>>> = {};
  let switchDelayMs = 0;
  let switchDoubleTapMs = 0;
  let section = '';
  let linkSource = '';

  for (const rawLine of content.split(/\r?\n/)) {
    const line = stripComment(rawLine);
    if (!line) continue;
    const sectionMatch = line.match(/^section:\s*([a-z]+)$/i);
    if (sectionMatch) {
      section = sectionMatch[1].toLowerCase();
      linkSource = '';
      continue;
    }
    if (line === 'end') {
      section = '';
      linkSource = '';
      continue;
    }

    if (section === 'screens' && !line.includes('=')) {
      const screen = line.replace(/:$/, '').trim();
      if (screen && !screens.includes(screen)) screens.push(screen);
      continue;
    }

    if (section === 'options' && line.includes('=')) {
      const [rawKey, rawValue] = line.split('=', 2).map((part) => part.trim());
      const value = Number.parseInt(rawValue, 10);
      if (rawKey === 'switchDelay' && Number.isFinite(value) && value > 0) switchDelayMs = value;
      if (rawKey === 'switchDoubleTap' && Number.isFinite(value) && value > 0) switchDoubleTapMs = value;
      continue;
    }

    if (section !== 'links') continue;
    if (!line.includes('=')) {
      linkSource = line.replace(/:$/, '').trim();
      if (linkSource && !links[linkSource]) links[linkSource] = {};
      continue;
    }
    if (!linkSource) continue;
    const [rawDirection, rawTarget] = line.split('=', 2).map((part) => part.trim());
    const sourceEndpoint = parseLinkEndpoint(rawDirection);
    const targetEndpoint = parseLinkEndpoint(rawTarget);
    if (!sourceEndpoint || !targetEndpoint) continue;
    const direction = sourceEndpoint.name.toLowerCase() as DeskflowDirection;
    if (!DESKFLOW_DIRECTIONS.includes(direction)) continue;
    const link: DeskflowLink = {
      target: targetEndpoint.name,
      sourceRange: sourceEndpoint.range,
      targetRange: targetEndpoint.range,
    };
    const directionLinks = links[linkSource][direction] ?? [];
    if (!directionLinks.some((existing) =>
      existing.target === link.target &&
      existing.sourceRange[0] === link.sourceRange[0] &&
      existing.sourceRange[1] === link.sourceRange[1] &&
      existing.targetRange[0] === link.targetRange[0] &&
      existing.targetRange[1] === link.targetRange[1]
    )) {
      directionLinks.push(link);
    }
    links[linkSource][direction] = directionLinks;
  }

  return {
    configPath,
    primaryScreen: null,
    screens,
    links,
    switchDelayMs,
    switchDoubleTapMs,
  };
}

function deskflowInstalled(): boolean {
  if (process.platform === 'darwin') {
    return fs.existsSync('/Applications/Deskflow.app/Contents/MacOS/deskflow-core');
  }
  if (process.platform === 'win32') {
    const roots = [process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean) as string[];
    return roots.some((root) => fs.existsSync(path.join(root, 'Deskflow', 'deskflow-core.exe')));
  }
  return ['/usr/bin/deskflow-core', '/usr/local/bin/deskflow-core'].some((file) => fs.existsSync(file));
}

function deskflowRunning(): boolean {
  try {
    if (process.platform === 'win32') {
      const output = execFileSync('tasklist.exe', ['/FI', 'IMAGENAME eq deskflow-core.exe', '/FO', 'CSV', '/NH'], {
        encoding: 'utf8',
        timeout: 3000,
        windowsHide: true,
      });
      return /deskflow-core\.exe/i.test(output);
    }
    execFileSync('/usr/bin/pgrep', ['-f', '/deskflow-core server'], {
      stdio: 'ignore',
      timeout: 3000,
    });
    return true;
  } catch {
    return false;
  }
}

function establishedPeerCount(): number {
  try {
    if (process.platform === 'darwin') {
      const output = execFileSync(
        '/usr/sbin/lsof',
        ['-nP', '-a', '-c', 'deskflow-core', '-iTCP:24800', '-sTCP:ESTABLISHED'],
        { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] }
      );
      return output.split(/\r?\n/).filter((line) => line.includes('->')).length;
    }
    if (process.platform === 'win32') {
      const output = execFileSync('netstat.exe', ['-ano', '-p', 'tcp'], {
        encoding: 'utf8',
        timeout: 3000,
        windowsHide: true,
      });
      return output.split(/\r?\n/).filter((line) => /:24800\s+.*ESTABLISHED/i.test(line)).length;
    }
    if (process.platform === 'linux') {
      const ss = firstExisting(['/usr/bin/ss', '/bin/ss']) ?? 'ss';
      const output = execFileSync(ss, ['-Htn'], {
        encoding: 'utf8',
        timeout: 3000,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      return output.split(/\r?\n/).filter((line) =>
        /^ESTAB\s/i.test(line.trim()) && /(?:^|\s)(?:\[[^\]]+]|[^\s]+):24800\s/.test(line)
      ).length;
    }
  } catch {
    // A missing process inspection tool should not make Deskflow itself unusable.
  }
  return 0;
}

export function getDeskflowStatus(): DeskflowStatus {
  const guiPath = firstExisting(guiSettingsCandidates());
  let primaryScreen: string | null = null;
  let serverMode = false;
  if (guiPath) {
    try {
      ({ name: primaryScreen, serverMode } = parsePrimaryScreen(fs.readFileSync(guiPath, 'utf8')));
    } catch {
      // Continue with the server configuration if the GUI settings are unreadable.
    }
  }

  const configPath = firstExisting(serverConfigCandidates(guiPath));
  let topology: DeskflowTopology = {
    configPath,
    primaryScreen,
    screens: [],
    links: {},
    switchDelayMs: 0,
    switchDoubleTapMs: 0,
  };
  if (configPath) {
    try {
      topology = parseDeskflowServerConfig(fs.readFileSync(configPath, 'utf8'), configPath);
      topology.primaryScreen = primaryScreen ?? topology.screens[0] ?? null;
    } catch {
      // Return a useful installed/running status even when the config is malformed.
    }
  }

  const processRunning = deskflowRunning();
  const canInferCliServer = !guiPath && Boolean(configPath);
  const peerCount = serverMode || canInferCliServer ? establishedPeerCount() : 0;
  const running = processRunning || peerCount > 0;
  if (canInferCliServer && running) serverMode = true;
  const remoteScreens = topology.screens.filter((screen) => screen !== topology.primaryScreen);
  const connectedScreens = peerCount === remoteScreens.length
    ? remoteScreens
    : peerCount === 1 && remoteScreens.length === 1
      ? remoteScreens
      : [];
  const twoScreenTopology = topology.screens.length === 2;
  const switchAvailable = running && serverMode && twoScreenTopology && peerCount > 0;
  let switchReason: string | null = null;
  if (!running) switchReason = 'Deskflow is not running.';
  else if (!serverMode) switchReason = 'This computer is not the Deskflow server.';
  else if (!configPath) switchReason = 'Deskflow server configuration was not found.';
  else if (!twoScreenTopology) switchReason = 'Safe edge switching currently requires exactly two configured computers.';
  else if (peerCount < 1) switchReason = 'No Deskflow client is currently connected.';

  return {
    ...topology,
    installed: deskflowInstalled(),
    running,
    serverMode,
    establishedPeerCount: peerCount,
    connectedScreens,
    switchAvailable,
    switchReason,
  };
}

export function resolveDeskflowTarget(status: DeskflowStatus, requestedTarget: string): string | null {
  const requested = requestedTarget.trim().toLowerCase();
  if (!requested) return null;
  const exact = status.screens.find((screen) => screen.toLowerCase() === requested);
  if (exact) return exact;

  if (['mac', 'macbook', 'local', 'server', 'this computer'].includes(requested)) {
    return status.primaryScreen;
  }
  if (['windows', 'windows pc', 'pc', 'remote', 'client'].includes(requested)) {
    const remoteScreens = status.screens.filter((screen) => screen !== status.primaryScreen);
    return remoteScreens.length === 1 ? remoteScreens[0] : null;
  }

  const partial = status.screens.filter((screen) => screen.toLowerCase().includes(requested));
  return partial.length === 1 ? partial[0] : null;
}

export function safeEdgeForTarget(
  status: DeskflowStatus,
  target: string
): DeskflowEdge | null {
  if (status.screens.length !== 2 || !status.screens.includes(target)) return null;
  const source = status.screens.find((screen) => screen !== target);
  if (!source) return null;

  for (const direction of DESKFLOW_DIRECTIONS) {
    const link = (status.links[source]?.[direction] ?? []).find((candidate) => candidate.target === target);
    if (!link) continue;
    // If already on the target, moving to this same edge must not jump away.
    if ((status.links[target]?.[direction] ?? []).some((candidate) => candidate.target !== target)) return null;
    return {
      direction,
      start: link.sourceRange[0] / 100,
      end: link.sourceRange[1] / 100,
      position: (link.sourceRange[0] + link.sourceRange[1]) / 200,
    };
  }
  return null;
}
