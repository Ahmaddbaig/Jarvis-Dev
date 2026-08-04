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

const DEFAULT_PORT = 45831;
const MAX_JSON_BYTES = 1024 * 1024;
const LEASE_MS = 60_000;
const PAIR_WINDOW_MS = 5 * 60_000;
const PAIR_CODE_MS = 5 * 60_000;
const PAIR_ATTEMPTS_PER_WINDOW = 5;

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
  for (const interfaces of Object.values(os.networkInterfaces())) {
    for (const entry of interfaces || []) {
      if (entry.family === 'IPv4' && !entry.internal) addresses.push(entry.address);
    }
  }
  return addresses;
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

function jsonResponse(res, status, body) {
  const payload = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': payload.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
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

function requirePoint(action, width, height) {
  if (!validNumber(action.x, 0, Math.max(0, width - 1)) || !validNumber(action.y, 0, Math.max(0, height - 1))) {
    throw new Error(`Input coordinates must be inside the primary display (${width}x${height}).`);
  }
  return { x: Math.round(action.x), y: Math.round(action.y) };
}

async function executeInputAction(action, width, height) {
  if (!action || typeof action !== 'object') throw new Error('Invalid input action.');
  const type = action.type;
  const buttons = ['left', 'right', 'middle'];

  if (type === 'move') {
    const point = requirePoint(action, width, height);
    robot.moveMouse(point.x, point.y);
    return;
  }
  if (type === 'click' || type === 'double_click') {
    const point = requirePoint(action, width, height);
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
    const point = requirePoint(action, width, height);
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
    const points = action.path.map((point) => requirePoint(point, width, height));
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

function launchApplication(application) {
  if (typeof application !== 'string' || application.length < 1 || application.length > 160 || /[\r\n\0]/.test(application)) {
    throw new Error('Invalid application name.');
  }

  let command;
  let args;
  if (process.platform === 'darwin') {
    command = '/usr/bin/open';
    args = ['-a', application];
  } else if (process.platform === 'win32') {
    command = 'powershell.exe';
    args = ['-NoProfile', '-NonInteractive', '-Command', 'Start-Process -FilePath $args[0]', application];
  } else {
    if (!/^[a-z0-9._+-]+$/i.test(application)) throw new Error('Linux application names may not contain spaces.');
    command = application;
    args = [];
  }

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { detached: false, stdio: 'ignore', windowsHide: true, shell: false });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Timed out while launching ${application}.`));
    }, 10_000);
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`Could not launch ${application} (exit code ${String(code)}).`));
    });
  });
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
  let pairingCode = freshPairingCode();
  let pairingExpiresAt = Date.now() + PAIR_CODE_MS;
  let paused = false;
  let lease = null;
  const pairAttempts = new Map();

  const saveIdentity = () => writePrivateJson(state.identityPath, state.identity);
  const pairingInfo = () => ({
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
        protocol: 1,
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
      try { displays = await screenshot.listDisplays(); } catch { /* capture will report a useful error */ }
      jsonResponse(res, 200, {
        protocol: 1,
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
      jsonResponse(res, 200, { leaseToken, expiresAt: new Date(lease.expiresAt).toISOString() });
      return;
    }

    if (req.method === 'POST' && pathname === '/v1/control/release') {
      if (!activeLease(controller, req)) {
        jsonResponse(res, 409, { error: 'A matching active control lease is required.' });
        return;
      }
      lease = null;
      notify();
      jsonResponse(res, 200, { released: true });
      return;
    }

    if (!activeLease(controller, req)) {
      jsonResponse(res, paused ? 423 : 409, { error: paused ? 'Companion control is paused locally.' : 'Claim a valid control lease first.' });
      return;
    }
    lease.expiresAt = Date.now() + LEASE_MS;

    if (req.method === 'POST' && pathname === '/v1/capture') {
      const body = await readJson(req);
      if (body.screen !== undefined && body.screen !== 0) {
        jsonResponse(res, 400, { error: 'Only primary-display capture is currently supported.' });
        return;
      }
      const displays = await screenshot.listDisplays();
      if (!Array.isArray(displays) || displays.length === 0) throw new Error('No displays were detected. Check screen-recording permission.');
      robot.updateScreenMetrics();
      const size = robot.getScreenSize();
      const primaryDisplay = displays.find((display) =>
        display.primary === true || (display.left === 0 && display.top === 0)
      ) || displays[0];
      const screenSelector = process.platform === 'win32' ? primaryDisplay.id : 0;
      const capturedImage = await screenshot({ format: 'jpg', screen: screenSelector });
      // macOS captures Retina pixels while RobotJS uses logical coordinates.
      // Normalize every screenshot so model coordinates exactly match input.
      const image = await sharp(capturedImage)
        .resize(size.width, size.height, { fit: 'fill' })
        .jpeg({ quality: 82 })
        .toBuffer();
      jsonResponse(res, 200, {
        mimeType: 'image/jpeg',
        width: size.width,
        height: size.height,
        screen: 0,
        imageBase64: image.toString('base64'),
      });
      return;
    }

    if (req.method === 'POST' && pathname === '/v1/input') {
      const body = await readJson(req);
      if (!Array.isArray(body.actions) || body.actions.length < 1 || body.actions.length > 50) {
        jsonResponse(res, 400, { error: 'Input requires between one and 50 actions.' });
        return;
      }
      robot.updateScreenMetrics();
      const size = robot.getScreenSize();
      for (const action of body.actions) await executeInputAction(action, size.width, size.height);
      jsonResponse(res, 200, { success: true, actionsExecuted: body.actions.length });
      return;
    }

    if (req.method === 'POST' && pathname === '/v1/apps/launch') {
      const body = await readJson(req);
      await launchApplication(body.application);
      jsonResponse(res, 200, { success: true, application: body.application });
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
