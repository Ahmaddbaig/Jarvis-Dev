'use strict';

const crypto = require('crypto');
const fs = require('fs');
const https = require('https');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const selfsigned = require('selfsigned');
const robot = require('@jitsi/robotjs');
const screenshot = require('screenshot-desktop');
const sharp = require('sharp');
const remoteProtocol = require('./remote-protocol.json');
const { ResultLedger } = require('./result-ledger.cjs');
const companionPackage = require('./package.json');

const DEFAULT_PORT = 45831;
const MAX_JSON_BYTES = 1024 * 1024;
const LEASE_MS = 60_000;
const PAIR_WINDOW_MS = 5 * 60_000;
const PAIR_CODE_MS = 5 * 60_000;
const PAIR_ATTEMPTS_PER_WINDOW = 5;
const PREVIEW_MIN_INTERVAL_MS = 500;
const PREVIEW_MAX_WIDTH = 960;
const COMPONENT_VERSION = companionPackage.version;
const BUILD_ID = process.env.JARVIS_COMPANION_BUILD_ID || COMPONENT_VERSION;

function defaultDataDir() {
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'Jarvis Companion');
  }
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Jarvis Companion');
  }
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'jarvis-companion');
}

function privateLanAddresses() {
  const addresses = [];
  for (const [interfaceName, interfaces] of Object.entries(os.networkInterfaces())) {
    for (const entry of interfaces || []) {
      if (entry.family !== 'IPv4' || entry.internal) continue;
      const octets = entry.address.split('.').map(Number);
      const isPrivate = octets[0] === 10 ||
        (octets[0] === 169 && octets[1] === 254) ||
        (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
        (octets[0] === 192 && octets[1] === 168);
      if (!isPrivate) continue;
      const virtual = /(?:docker|wsl|hyper-v|vethernet|vmware|vbox|virtual|vpn|tun|tap|utun|tailscale|zerotier)/i.test(interfaceName);
      addresses.push({ address: entry.address, virtual });
    }
  }
  return [...new Map(
    addresses.sort((left, right) => Number(left.virtual) - Number(right.virtual))
      .map((entry) => [entry.address, entry.address])
  ).values()];
}

function windowsSystemTool(filename) {
  const root = process.env.SystemRoot || process.env.windir || 'C:\\Windows';
  const candidates = [path.join(root, 'System32', filename), path.join(root, 'Sysnative', filename)];
  return candidates.find((candidate) => fs.existsSync(candidate)) || candidates[0];
}

function windowsChildEnvironment(extra = {}) {
  const root = process.env.SystemRoot || process.env.windir || 'C:\\Windows';
  const existing = process.env.Path || process.env.PATH || '';
  const merged = [
    existing,
    path.join(root, 'System32'),
    root,
    path.join(root, 'System32', 'Wbem'),
    path.join(root, 'System32', 'WindowsPowerShell', 'v1.0'),
  ].filter(Boolean).join(';');
  return { ...process.env, Path: merged, PATH: merged, ...extra };
}

function writePrivateJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), { encoding: 'utf8', mode: 0o600 });
  try { fs.chmodSync(filePath, 0o600); } catch { /* Windows has no POSIX mode */ }
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function secureEqualHex(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string' || left.length !== right.length) return false;
  return crypto.timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}

function freshPairingCode() {
  return String(crypto.randomInt(100000, 1_000_000));
}

function jsonResponse(res, status, body, extraHeaders = {}) {
  const payload = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': payload.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...extraHeaders,
  });
  res.end(payload);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_JSON_BYTES) {
        reject(new Error('Request body is too large.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error('Request body must be valid JSON.'));
      }
    });
    req.on('error', reject);
  });
}

function validNumber(value, min, max) {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeKey(value) {
  if (typeof value !== 'string' || !/^[a-z0-9_+ -]{1,24}$/i.test(value)) {
    throw new Error('Invalid key name.');
  }
  const aliases = {
    return: 'enter', command: 'command', cmd: 'command', meta: process.platform === 'darwin' ? 'command' : 'win',
    control: 'control', ctrl: 'control', esc: 'escape', del: 'delete',
    arrowleft: 'left', arrowright: 'right', arrowup: 'up', arrowdown: 'down',
  };
  return aliases[value.toLowerCase()] || value.toLowerCase();
}

function requirePoint(action, width, height, offsetX = 0, offsetY = 0) {
  if (!validNumber(action.x, 0, Math.max(0, width - 1)) || !validNumber(action.y, 0, Math.max(0, height - 1))) {
    throw new Error(`Input coordinates must be inside the selected display (${width}x${height}).`);
  }
  return { x: Math.round(action.x + offsetX), y: Math.round(action.y + offsetY) };
}

async function executeInputAction(action, width, height, offsetX = 0, offsetY = 0) {
  if (!action || typeof action !== 'object') throw new Error('Invalid input action.');
  const type = action.type;
  const buttons = ['left', 'right', 'middle'];

  if (type === 'move') {
    const point = requirePoint(action, width, height, offsetX, offsetY);
    robot.moveMouse(point.x, point.y);
    return;
  }
  if (type === 'click' || type === 'double_click') {
    const point = requirePoint(action, width, height, offsetX, offsetY);
    const button = buttons.includes(action.button) ? action.button : 'left';
    robot.moveMouse(point.x, point.y);
    robot.mouseClick(button, type === 'double_click');
    return;
  }
  if (type === 'type') {
    if (typeof action.text !== 'string' || action.text.length > 4000) throw new Error('Typed text must be 4000 characters or fewer.');
    robot.typeString(action.text);
    return;
  }
  if (type === 'keypress') {
    if (!Array.isArray(action.keys) || action.keys.length < 1 || action.keys.length > 5) {
      throw new Error('keypress requires between one and five keys.');
    }
    const keys = action.keys.map(normalizeKey);
    if (keys.length === 1) robot.keyTap(keys[0]);
    else robot.keyTap(keys[keys.length - 1], keys.slice(0, -1));
    return;
  }
  if (type === 'scroll') {
    const point = requirePoint(action, width, height, offsetX, offsetY);
    robot.moveMouse(point.x, point.y);
    const horizontal = clamp(Math.trunc(-Number(action.scrollX || 0) / 100), -20, 20);
    const vertical = clamp(Math.trunc(-Number(action.scrollY || 0) / 100), -20, 20);
    robot.scrollMouse(horizontal, vertical);
    return;
  }
  if (type === 'drag') {
    if (!Array.isArray(action.path) || action.path.length < 2 || action.path.length > 100) {
      throw new Error('drag requires a path of 2 to 100 points.');
    }
    const points = action.path.map((point) => requirePoint(point, width, height, offsetX, offsetY));
    robot.moveMouse(points[0].x, points[0].y);
    robot.mouseToggle('down', 'left');
    try {
      for (const point of points.slice(1)) robot.dragMouse(point.x, point.y);
    } finally {
      robot.mouseToggle('up', 'left');
    }
    return;
  }
  if (type === 'wait') {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    return;
  }
  throw new Error(`Unsupported input action: ${String(type)}`);
}

function firstExistingFile(candidates) {
  return candidates.find((candidate) => candidate && fs.existsSync(candidate)) || null;
}

function windowsApplication(application) {
  const requested = application.trim();
  const normalized = requested
    .toLowerCase()
    .replace(/\.exe$/, '')
    .replace(/\s+/g, ' ')
    .replace(/^(?:please\s+)?(?:open|launch|start|run)\s+(?:the\s+)?/, '')
    .replace(/\s+(?:app|application)$/, '')
    .trim();
  const root = process.env.SystemRoot || process.env.windir || 'C:\\Windows';
  const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
  const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const roamingAppData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  const notepadExecutable = firstExistingFile([
    path.join(root, 'System32', 'notepad.exe'),
    path.join(root, 'notepad.exe'),
    path.join(localAppData, 'Microsoft', 'WindowsApps', 'notepad.exe'),
  ]) || 'notepad.exe';
  const aliases = {
    notepad: { command: notepadExecutable, args: [], title: 'Notepad' },
    'microsoft notepad': { command: notepadExecutable, args: [], title: 'Notepad' },
    'windows notepad': { command: notepadExecutable, args: [], title: 'Notepad' },
    'text editor': { command: notepadExecutable, args: [], title: 'Notepad' },
    calculator: { command: windowsSystemTool('calc.exe'), args: [], title: 'Calculator' },
    calc: { command: windowsSystemTool('calc.exe'), args: [], title: 'Calculator' },
    settings: { command: windowsSystemTool('explorer.exe'), args: ['ms-settings:'], title: 'Settings' },
    explorer: { command: windowsSystemTool('explorer.exe'), args: [], title: 'File Explorer' },
    'file explorer': { command: windowsSystemTool('explorer.exe'), args: [], title: 'File Explorer' },
    'command prompt': { command: windowsSystemTool('cmd.exe'), args: [], title: 'Command Prompt' },
    cmd: { command: windowsSystemTool('cmd.exe'), args: [], title: 'Command Prompt' },
    powershell: {
      command: path.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      args: [],
      title: 'Windows PowerShell',
    },
  };
  if (aliases[normalized]) return aliases[normalized];

  if (normalized === 'discord') {
    const updater = path.join(localAppData, 'Discord', 'Update.exe');
    return fs.existsSync(updater)
      ? { command: updater, args: ['--processStart', 'Discord.exe'], title: 'Discord' }
      : { command: 'Discord.exe', args: [], title: 'Discord' };
  }
  if (normalized === 'spotify') {
    const installed = firstExistingFile([path.join(roamingAppData, 'Spotify', 'Spotify.exe')]);
    return installed
      ? { command: installed, args: [], title: 'Spotify' }
      : { command: windowsSystemTool('explorer.exe'), args: ['spotify:'], title: 'Spotify' };
  }

  const knownApps = {
    chrome: {
      paths: [
        path.join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      ],
      fallback: 'chrome.exe',
      title: 'Google Chrome',
    },
    'google chrome': null,
    edge: {
      paths: [
        path.join(programFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        path.join(programFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      ],
      fallback: 'msedge.exe',
      title: 'Microsoft Edge',
    },
    'microsoft edge': null,
  };
  knownApps['google chrome'] = knownApps.chrome;
  knownApps['microsoft edge'] = knownApps.edge;
  const known = knownApps[normalized];
  if (known) {
    return { command: firstExistingFile(known.paths) || known.fallback, args: [], title: known.title };
  }

  if (path.isAbsolute(requested)) {
    if (!fs.existsSync(requested)) throw new Error(`Application was not found at ${requested}.`);
    return { command: requested, args: [], title: path.basename(requested, path.extname(requested)) };
  }
  if (!/^[a-z0-9._+-]+(?:\.exe)?$/i.test(requested)) {
    throw new Error(`Unknown Windows application “${requested}”. Try a known name such as Chrome, Edge, Spotify, Notepad, Calculator, Settings, or File Explorer.`);
  }
  return { command: requested, args: [], title: path.basename(requested, path.extname(requested)) };
}

function focusWindowsApplication(processId, title) {
  const script = [
    'Start-Sleep -Milliseconds 900',
    '$shell=New-Object -ComObject WScript.Shell',
    '$activated=$false',
    'if ($env:JARVIS_COMPANION_PID -match "^[0-9]+$") { $activated=$shell.AppActivate([int]$env:JARVIS_COMPANION_PID) }',
    'if (-not $activated -and $env:JARVIS_COMPANION_TITLE) { $activated=$shell.AppActivate($env:JARVIS_COMPANION_TITLE) }',
  ].join(';');
  return new Promise((resolve) => {
    const child = spawn(
      windowsSystemTool('WindowsPowerShell\\v1.0\\powershell.exe'),
      ['-NoProfile', '-NonInteractive', '-Command', script],
      {
        stdio: 'ignore',
        windowsHide: true,
        shell: false,
        env: windowsChildEnvironment({
          JARVIS_COMPANION_PID: String(processId || ''),
          JARVIS_COMPANION_TITLE: title || '',
        }),
      }
    );
    child.once('error', () => resolve());
    child.once('exit', () => resolve());
  });
}

function launchApplication(application) {
  if (typeof application !== 'string' || application.length < 1 || application.length > 160 || /[\r\n\0]/.test(application)) {
    throw new Error('Invalid application name.');
  }

  let command;
  let args;
  let windowTitle = '';
  if (process.platform === 'darwin') {
    command = '/usr/bin/open';
    args = ['-a', application];
  } else if (process.platform === 'win32') {
    const resolved = windowsApplication(application);
    command = resolved.command;
    args = resolved.args;
    windowTitle = resolved.title;
  } else {
    if (!/^[a-z0-9._+-]+$/i.test(application)) throw new Error('Linux application names may not contain spaces.');
    command = application;
    args = [];
  }

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      detached: process.platform === 'win32',
      stdio: 'ignore',
      // Apps launched by the companion are meant to be visible. Hiding the
      // child window prevents GUI tools such as Notepad from appearing on some
      // Windows builds.
      windowsHide: false,
      shell: false,
      env: process.platform === 'win32' ? windowsChildEnvironment() : process.env,
    });
    const timer = setTimeout(() => {
      reject(new Error(`Timed out while launching ${application}.`));
    }, 10_000);
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('spawn', async () => {
      if (process.platform === 'win32') {
        clearTimeout(timer);
        child.unref();
        await focusWindowsApplication(child.pid, windowTitle);
        resolve();
      }
    });
    child.once('exit', (code) => {
      if (process.platform === 'win32') return;
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`Could not launch ${application} (exit code ${String(code)}).`));
    });
  });
}

async function displayLayout() {
  const detected = await screenshot.listDisplays();
  if (!Array.isArray(detected) || detected.length === 0) {
    throw new Error('No displays were detected. Check screen-recording permission.');
  }
  robot.updateScreenMetrics();
  const primarySize = robot.getScreenSize();
  const primary = detected.find((display) => display.primary === true) ||
    detected.find((display) => Number(display.left) === 0 && Number(display.top) === 0) ||
    detected[0];
  const ordered = [primary, ...detected.filter((display) => display !== primary)];
  return ordered.map((display, index) => {
    const detectedIndex = detected.indexOf(display);
    const isPrimary = index === 0;
    const width = isPrimary ? primarySize.width : Number(display.width);
    const height = isPrimary ? primarySize.height : Number(display.height);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
      throw new Error(`Display ${index} reported invalid dimensions.`);
    }
    return {
      ...display,
      primary: isPrimary,
      jarvisScreen: index,
      width,
      height,
      left: Number.isFinite(Number(display.left)) ? Number(display.left) : 0,
      top: Number.isFinite(Number(display.top)) ? Number(display.top) : 0,
      captureSelector: process.platform === 'win32' ? display.id : detectedIndex,
    };
  });
}

async function captureDisplay(screen, preview = false) {
  const displays = await displayLayout();
  const display = selectedDisplay(displays, screen);
  const capturedImage = await screenshot({ format: 'jpg', screen: display.captureSelector });
  // Normalize Retina/high-DPI captures to RobotJS coordinates first. Preview
  // frames are then reduced for responsive LAN streaming without changing the
  // full-resolution frames used by Computer Use.
  let pipeline = sharp(capturedImage).resize(display.width, display.height, { fit: 'fill' });
  if (preview) {
    pipeline = pipeline.resize({ width: PREVIEW_MAX_WIDTH, withoutEnlargement: true });
  }
  const encoded = await pipeline
    .jpeg({ quality: preview ? 58 : 82 })
    .toBuffer({ resolveWithObject: true });
  return {
    display,
    image: encoded.data,
    imageWidth: encoded.info.width,
    imageHeight: encoded.info.height,
  };
}

function selectedDisplay(displays, requested) {
  const screen = requested === undefined ? 0 : requested;
  if (!Number.isInteger(screen) || screen < 0 || screen >= displays.length) {
    throw new Error(`Screen must be an integer from 0 to ${Math.max(0, displays.length - 1)}.`);
  }
  return displays[screen];
}

async function createIdentity(dataDir, deviceName) {
  const identityPath = path.join(dataDir, 'identity.json');
  let identity;
  try {
    identity = JSON.parse(fs.readFileSync(identityPath, 'utf8'));
  } catch {
    identity = {
      version: 1,
      deviceId: crypto.randomUUID(),
      deviceName: deviceName || os.hostname(),
      trustedControllers: [],
      createdAt: new Date().toISOString(),
    };
    writePrivateJson(identityPath, identity);
  }

  const tlsPath = path.join(dataDir, 'tls.json');
  let tlsFiles;
  try {
    tlsFiles = JSON.parse(fs.readFileSync(tlsPath, 'utf8'));
  } catch {
    const altNames = [
      { type: 2, value: os.hostname() },
      { type: 2, value: 'localhost' },
      { type: 7, ip: '127.0.0.1' },
      ...privateLanAddresses().map((ip) => ({ type: 7, ip })),
    ];
    const generated = await selfsigned.generate(
      [{ name: 'commonName', value: 'Jarvis Companion' }],
      {
        days: 3650,
        keySize: 2048,
        extensions: [
          { name: 'basicConstraints', cA: true },
          { name: 'keyUsage', keyCertSign: true, digitalSignature: true, keyEncipherment: true },
          { name: 'subjectAltName', altNames },
        ],
      }
    );
    tlsFiles = { private: generated.private, cert: generated.cert };
    writePrivateJson(tlsPath, tlsFiles);
  }

  const certificate = new crypto.X509Certificate(tlsFiles.cert);
  const fingerprint = certificate.fingerprint256.replaceAll(':', '').toLowerCase();
  return { identity, identityPath, tlsFiles, fingerprint };
}

async function startCompanion(options = {}) {
  const port = Number(options.port || process.env.JARVIS_COMPANION_PORT || DEFAULT_PORT);
  const host = options.host || process.env.JARVIS_COMPANION_HOST || '0.0.0.0';
  const dataDir = options.dataDir || process.env.JARVIS_COMPANION_DATA_DIR || defaultDataDir();
  const state = await createIdentity(dataDir, options.deviceName || process.env.JARVIS_COMPANION_NAME);
  const resultLedger = new ResultLedger({
    retentionMs: remoteProtocol.resultRetentionMs,
    filePath: path.join(dataDir, 'command-results.json'),
  });
  let pairingCode = freshPairingCode();
  let pairingExpiresAt = Date.now() + PAIR_CODE_MS;
  let paused = false;
  let lease = null;
  const pairAttempts = new Map();
  const previewRequestTimes = new Map();

  const saveIdentity = () => writePrivateJson(state.identityPath, state.identity);
  const pairingInfo = () => ({
    protocol: remoteProtocol.protocol,
    componentVersion: COMPONENT_VERSION,
    buildId: BUILD_ID,
    deviceId: state.identity.deviceId,
    deviceName: state.identity.deviceName,
    port,
    addresses: privateLanAddresses(),
    pairingCode,
    pairingExpiresAt: new Date(pairingExpiresAt).toISOString(),
    fingerprint: state.fingerprint,
    fingerprintShort: state.fingerprint.slice(0, 16).match(/.{1,4}/g).join('-'),
    platform: process.platform,
    paused,
    controllerName: lease && lease.expiresAt > Date.now() ? lease.controllerName : null,
  });
  const notify = () => options.onStateChange?.(pairingInfo());
  const rotatePairingCode = () => {
    pairingCode = freshPairingCode();
    pairingExpiresAt = Date.now() + PAIR_CODE_MS;
    notify();
  };
  const pairingTimer = setInterval(rotatePairingCode, PAIR_CODE_MS);
  pairingTimer.unref?.();

  function authenticate(req) {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!/^[a-f0-9]{64}$/.test(token)) return null;
    const tokenHash = sha256(token);
    return state.identity.trustedControllers.find((entry) => secureEqualHex(entry.tokenHash, tokenHash)) || null;
  }

  function activeLease(controller, req) {
    if (paused || !lease || lease.expiresAt <= Date.now()) return false;
    const supplied = req.headers['x-jarvis-lease'];
    if (typeof supplied !== 'string') return false;
    return lease.controllerId === controller.id && secureEqualHex(lease.tokenHash, sha256(supplied));
  }

  async function route(req, res) {
    const requestUrl = new URL(req.url || '/', `https://${req.headers.host || 'localhost'}`);
    const pathname = requestUrl.pathname;
    if (req.method === 'GET' && pathname === '/v1/identity') {
      jsonResponse(res, 200, {
        protocol: remoteProtocol.protocol,
        componentVersion: COMPONENT_VERSION,
        buildId: BUILD_ID,
        capabilities: remoteProtocol.companionCapabilities,
        deviceId: state.identity.deviceId,
        deviceName: state.identity.deviceName,
        platform: process.platform,
        arch: process.arch,
        hostname: os.hostname(),
        fingerprint: state.fingerprint,
        pairingRequired: true,
      });
      return;
    }

    if (req.method === 'POST' && pathname === '/v1/pair') {
      const remote = req.socket.remoteAddress || 'unknown';
      const now = Date.now();
      const recent = (pairAttempts.get(remote) || []).filter((time) => now - time < PAIR_WINDOW_MS);
      if (recent.length >= PAIR_ATTEMPTS_PER_WINDOW) {
        jsonResponse(res, 429, { error: 'Too many pairing attempts. Wait five minutes.' });
        return;
      }
      recent.push(now);
      pairAttempts.set(remote, recent);
      const body = await readJson(req);
      if (body.protocol !== remoteProtocol.protocol) {
        jsonResponse(res, 409, { error: `Controller protocol ${String(body.protocol)} is incompatible with companion protocol ${remoteProtocol.protocol}.` });
        return;
      }
      if (typeof body.controllerVersion !== 'string' || !Array.isArray(body.capabilities)) {
        jsonResponse(res, 400, { error: 'Controller build and capability identity is required.' });
        return;
      }
      if (Date.now() >= pairingExpiresAt) {
        rotatePairingCode();
        jsonResponse(res, 403, { error: 'Pairing code expired. Copy the new code from the companion tray.' });
        return;
      }
      if (String(body.code || '') !== pairingCode) {
        jsonResponse(res, 403, { error: 'Incorrect pairing code.' });
        return;
      }
      const controllerName = typeof body.controllerName === 'string' && body.controllerName.trim()
        ? body.controllerName.trim().slice(0, 100)
        : 'Jarvis Controller';
      const token = crypto.randomBytes(32).toString('hex');
      const controller = {
        id: crypto.randomUUID(),
        name: controllerName,
        tokenHash: sha256(token),
        pairedAt: new Date().toISOString(),
      };
      state.identity.trustedControllers.push(controller);
      saveIdentity();
      rotatePairingCode();
      jsonResponse(res, 201, {
        protocol: remoteProtocol.protocol,
        componentVersion: COMPONENT_VERSION,
        buildId: BUILD_ID,
        capabilities: remoteProtocol.companionCapabilities,
        token,
        deviceId: state.identity.deviceId,
        deviceName: state.identity.deviceName,
        platform: process.platform,
        arch: process.arch,
        fingerprint: state.fingerprint,
      });
      return;
    }

    const controller = authenticate(req);
    if (!controller) {
      jsonResponse(res, 401, { error: 'A valid paired-controller token is required.' });
      return;
    }

    if (req.method === 'POST' && pathname === '/v1/results/ack') {
      const body = await readJson(req);
      const keys = Array.isArray(body.idempotencyKeys)
        ? body.idempotencyKeys.filter((key) => typeof key === 'string').slice(0, 100)
        : [];
      if (keys.length === 0) {
        jsonResponse(res, 400, { error: 'At least one idempotency key is required.' });
        return;
      }
      jsonResponse(res, 200, { acknowledged: resultLedger.acknowledge(controller.id, keys) });
      return;
    }

    const idempotentPath = req.method === 'POST' && [
      '/v1/control/claim',
      '/v1/control/release',
      '/v1/input',
      '/v1/apps/launch',
    ].includes(pathname);
    let commandBody = null;
    let commandContext = null;
    if (idempotentPath) {
      commandBody = await readJson(req);
      commandContext = resultLedger.prepare({
        controllerId: controller.id,
        idempotencyKey: req.headers['x-jarvis-idempotency-key'],
        deadline: req.headers['x-jarvis-deadline'],
        method: req.method,
        pathname,
        body: commandBody,
      });
      if (commandContext.kind === 'error') {
        jsonResponse(res, commandContext.status, { error: commandContext.error });
        return;
      }
      if (commandContext.kind === 'replay') {
        jsonResponse(res, commandContext.status, commandContext.body, { 'X-Jarvis-Idempotent-Replay': '1' });
        return;
      }
    }

    // Read-only live preview uses authentication but deliberately does not
    // claim the exclusive input lease. This lets Jarvis keep controlling the
    // computer while its display is visible in the HUD.
    if (req.method === 'POST' && pathname === '/v1/preview') {
      if (paused) {
        jsonResponse(res, 423, { error: 'Companion control is paused locally.' });
        return;
      }
      const now = Date.now();
      const previous = previewRequestTimes.get(controller.id) || 0;
      if (now - previous < PREVIEW_MIN_INTERVAL_MS) {
        jsonResponse(res, 429, { error: 'Preview refresh is too frequent.' });
        return;
      }
      previewRequestTimes.set(controller.id, now);
      const body = await readJson(req);
      const captured = await captureDisplay(body.screen, true);
      jsonResponse(res, 200, {
        mimeType: 'image/jpeg',
        width: captured.imageWidth,
        height: captured.imageHeight,
        displayWidth: captured.display.width,
        displayHeight: captured.display.height,
        screen: captured.display.jarvisScreen,
        capturedAt: new Date().toISOString(),
        imageBase64: captured.image.toString('base64'),
      });
      return;
    }

    if (req.method === 'POST' && pathname === '/v1/controllers/revoke-self') {
      state.identity.trustedControllers = state.identity.trustedControllers.filter((entry) => entry.id !== controller.id);
      if (lease?.controllerId === controller.id) lease = null;
      saveIdentity();
      notify();
      jsonResponse(res, 200, { revoked: true });
      return;
    }

    if (req.method === 'GET' && pathname === '/v1/status') {
      robot.updateScreenMetrics();
      const screen = robot.getScreenSize();
      let displays = [];
      try {
        displays = (await displayLayout()).map(({ captureSelector: _captureSelector, ...display }) => display);
      } catch { /* capture will report a useful error */ }
      jsonResponse(res, 200, {
        protocol: remoteProtocol.protocol,
        componentVersion: COMPONENT_VERSION,
        buildId: BUILD_ID,
        capabilities: remoteProtocol.companionCapabilities,
        deviceId: state.identity.deviceId,
        deviceName: state.identity.deviceName,
        platform: process.platform,
        arch: process.arch,
        hostname: os.hostname(),
        paused,
        screen,
        displays,
        lease: lease && lease.expiresAt > Date.now()
          ? { active: true, controllerName: lease.controllerName, expiresAt: new Date(lease.expiresAt).toISOString() }
          : { active: false },
      });
      return;
    }

    if (req.method === 'POST' && pathname === '/v1/control/claim') {
      if (paused) {
        jsonResponse(res, 423, { error: 'Companion control is paused locally.' });
        return;
      }
      if (lease && lease.expiresAt > Date.now() && lease.controllerId !== controller.id) {
        jsonResponse(res, 409, { error: `This computer is currently controlled by ${lease.controllerName}.` });
        return;
      }
      const leaseToken = crypto.randomBytes(32).toString('hex');
      lease = {
        controllerId: controller.id,
        controllerName: controller.name,
        tokenHash: sha256(leaseToken),
        expiresAt: Date.now() + LEASE_MS,
      };
      notify();
      const result = { leaseToken, expiresAt: new Date(lease.expiresAt).toISOString() };
      resultLedger.record(commandContext, 200, result, false);
      jsonResponse(res, 200, result);
      return;
    }

    if (req.method === 'POST' && pathname === '/v1/control/release') {
      if (!activeLease(controller, req)) {
        jsonResponse(res, 409, { error: 'A matching active control lease is required.' });
        return;
      }
      lease = null;
      notify();
      const result = { released: true };
      resultLedger.record(commandContext, 200, result, false);
      jsonResponse(res, 200, result);
      return;
    }

    if (!activeLease(controller, req)) {
      jsonResponse(res, paused ? 423 : 409, { error: paused ? 'Companion control is paused locally.' : 'Claim a valid control lease first.' });
      return;
    }
    lease.expiresAt = Date.now() + LEASE_MS;

    if (req.method === 'POST' && pathname === '/v1/capture') {
      const body = await readJson(req);
      const captured = await captureDisplay(body.screen, false);
      jsonResponse(res, 200, {
        mimeType: 'image/jpeg',
        width: captured.display.width,
        height: captured.display.height,
        screen: captured.display.jarvisScreen,
        imageBase64: captured.image.toString('base64'),
      });
      return;
    }

    if (req.method === 'POST' && pathname === '/v1/input') {
      const body = commandBody;
      if (!Array.isArray(body.actions) || body.actions.length < 1 || body.actions.length > 50) {
        jsonResponse(res, 400, { error: 'Input requires between one and 50 actions.' });
        return;
      }
      const display = selectedDisplay(await displayLayout(), body.screen);
      for (const action of body.actions) {
        await executeInputAction(action, display.width, display.height, display.left, display.top);
      }
      const result = {
        success: true,
        actionsExecuted: body.actions.length,
        screen: display.jarvisScreen,
      };
      resultLedger.record(commandContext, 200, result, true);
      jsonResponse(res, 200, result);
      return;
    }

    if (req.method === 'POST' && pathname === '/v1/apps/launch') {
      const body = commandBody;
      await launchApplication(body.application);
      const result = { success: true, application: body.application };
      resultLedger.record(commandContext, 200, result, true);
      jsonResponse(res, 200, result);
      return;
    }

    jsonResponse(res, 404, { error: 'Unknown companion endpoint.' });
  }

  const server = https.createServer({ key: state.tlsFiles.private, cert: state.tlsFiles.cert }, (req, res) => {
    route(req, res).catch((error) => {
      if (!res.headersSent) jsonResponse(res, 500, { error: error instanceof Error ? error.message : String(error) });
      else res.destroy();
    });
  });
  server.on('clientError', (_error, socket) => socket.destroy());

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve();
    });
  });

  const info = pairingInfo();
  console.log(`[companion] ${info.deviceName} listening securely on port ${port}`);
  console.log(`[companion] Pairing code: ${info.pairingCode}`);
  console.log(`[companion] Verify fingerprint: ${info.fingerprintShort}`);
  for (const address of info.addresses) console.log(`[companion] Address: https://${address}:${port}`);
  notify();

  return {
    server,
    getInfo: pairingInfo,
    setPaused(value) {
      paused = Boolean(value);
      if (paused) lease = null;
      notify();
      return pairingInfo();
    },
    stop: () => new Promise((resolve) => {
      clearInterval(pairingTimer);
      server.close(resolve);
    }),
  };
}

module.exports = { DEFAULT_PORT, startCompanion };

if (require.main === module) {
  startCompanion().catch((error) => {
    console.error('[companion] Failed to start:', error);
    process.exitCode = 1;
  });
}
