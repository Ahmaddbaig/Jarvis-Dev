import {
    app,
    BrowserWindow,
    desktopCapturer,
    dialog,
    ipcMain,
    protocol,
    screen,
    session,
    shell,
    systemPreferences,
    type Display,
    type Rectangle,
} from 'electron';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {
    startLanGateway,
    type LanGatewayController,
} from './lan-gateway';

type DesktopPanelPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
type DesktopWindowKind = 'visual' | 'hitbox';
type MacPermission = 'accessibility' | 'screen' | 'microphone';

interface DesktopModeOptions {
    enabled: boolean;
    logo?: string;
    muted?: boolean;
    position?: DesktopPanelPosition;
}

interface MacPermissionStatus {
    available: boolean;
    accessibility?: string;
    screen?: string;
    microphone?: string;
    appBundlePath?: string;
}

function errorCode(error: unknown): string | undefined {
    if (!error || typeof error !== 'object' || !('code' in error)) return undefined;
    return typeof error.code === 'string' ? error.code : undefined;
}

const CHROME_CONTROL_UI_TOKEN = process.env.JARVIS_CHROME_UI_TOKEN || crypto.randomBytes(32).toString('base64url');
process.env.JARVIS_CHROME_UI_TOKEN = CHROME_CONTROL_UI_TOKEN;
const isDev = !app.isPackaged;
const APP_ICON_PATH = isDev
    ? path.join(__dirname, '..', 'buildfiles', 'icon.png')
    : path.join(process.resourcesPath, 'buildfiles', 'icon.png');
process.env.JARVIS_CHROME_EXTENSION_PATH = isDev
    ? path.join(__dirname, '..', 'chrome-extension')
    : path.join(process.resourcesPath, 'chrome-extension');
const PORT = Number.parseInt(process.env.JARVIS_PORT || (isDev ? '3100' : '3000'), 10);
const HTTPS_PORT = Number.parseInt(process.env.JARVIS_HTTPS_PORT || (isDev ? '3543' : '3443'), 10);
// Finder/open launches Electron with `/` as its working directory. Resolve the
// development token beside the Jarvis source instead of relying on cwd, which
// would otherwise try to write `/jarvis-desktop-token` on macOS.
const DESKTOP_TOKEN_DIR = process.env.JARVIS_PROJECT_DIR || app.getAppPath();
const DESKTOP_TOKEN_PATH = path.join(DESKTOP_TOKEN_DIR, '.jarvis-desktop-token');
function loadDesktopControlToken(): string {
    const environmentToken = process.env.JARVIS_DESKTOP_TOKEN?.trim();
    if (environmentToken && /^[A-Za-z0-9_-]{43}$/.test(environmentToken))
        return environmentToken;
    // Packaged Next.js is spawned by this process and inherits the in-memory
    // token, so no secret needs to be written beside the installed app.
    if (!isDev)
        return crypto.randomBytes(32).toString('base64url');
    try {
        const existing = fs.readFileSync(DESKTOP_TOKEN_PATH, 'utf8').trim();
        if (/^[A-Za-z0-9_-]{43}$/.test(existing))
            return existing;
    }
    catch (error) {
        if (errorCode(error) !== 'ENOENT')
            throw error;
    }
    const token = crypto.randomBytes(32).toString('base64url');
    try {
        fs.writeFileSync(DESKTOP_TOKEN_PATH, `${token}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
        try {
            fs.chmodSync(DESKTOP_TOKEN_PATH, 0o600);
        }
        catch { /* Windows has no POSIX mode. */ }
        return token;
    }
    catch (error) {
        if (errorCode(error) !== 'EEXIST')
            throw error;
        const existing = fs.readFileSync(DESKTOP_TOKEN_PATH, 'utf8').trim();
        if (!/^[A-Za-z0-9_-]{43}$/.test(existing))
            throw new Error('The Jarvis desktop token file is invalid.');
        return existing;
    }
}
const DESKTOP_CONTROL_TOKEN = loadDesktopControlToken();
process.env.JARVIS_DESKTOP_TOKEN = DESKTOP_CONTROL_TOKEN;
// Keep this editable build separate from the Patreon-installed Jarvis app.
app.setPath('userData', path.join(app.getPath('appData'), 'Jarvis Dev'));
app.setName('Jarvis Dev');
const CORE_DATA_DIR = process.env.JARVIS_DATA_DIR || (isDev ? app.getAppPath() : app.getPath('userData'));
process.env.JARVIS_DATA_DIR = CORE_DATA_DIR;
// Global safety net: ECONNRESET / EPIPE are harmless connection-level errors
// that happen when a phone/tablet disconnects mid-request (iOS tab kill, screen
// lock, navigation). Without this handler they surface as an uncaught exception
// and crash the entire Electron main process, which restarts the app and reloads
// every connected client. We swallow them here; all other errors are re-thrown.
process.on('uncaughtException', (err) => {
    const code = errorCode(err);
    if (code === 'ECONNRESET' || code === 'EPIPE') {
        console.warn('[jarvis] Swallowed uncaught', code, '— client disconnected mid-request.');
        return;
    }
    throw err;
});
process.on('unhandledRejection', (reason) => {
    const code = errorCode(reason);
    if (code === 'ECONNRESET' || code === 'EPIPE') {
        console.warn('[jarvis] Swallowed unhandledRejection', code);
        return;
    }
    console.error('[jarvis] Unhandled rejection:', reason);
});
/** Lets the Next.js UI load local PDFs from absolute paths inside an iframe. */
protocol.registerSchemesAsPrivileged([
    {
        scheme: 'jarvis-pdf',
        privileges: {
            standard: true,
            secure: true,
            supportFetchAPI: true,
            corsEnabled: true,
        },
    },
]);
function registerJarvisPdfProtocol(): void {
    protocol.registerFileProtocol('jarvis-pdf', (request, callback) => {
        try {
            const marker = 'jarvis-pdf://';
            if (!request.url.startsWith(marker)) {
                callback({ error: -2 });
                return;
            }
            let encoded = request.url.slice(marker.length);
            while (encoded.startsWith('/'))
                encoded = encoded.slice(1);
            const filePath = path.normalize(decodeURIComponent(encoded));
            if (!filePath.toLowerCase().endsWith('.pdf')) {
                callback({ error: -6 });
                return;
            }
            if (!fs.existsSync(filePath)) {
                callback({ error: -6 });
                return;
            }
            callback({ path: filePath });
        }
        catch {
            callback({ error: -2 });
        }
    });
}
// Set Dock icon in dev mode (packaged builds use electron-builder.yml icon)
if (isDev && process.platform === 'darwin' && app.dock) {
    app.dock.setIcon(APP_ICON_PATH);
}
let mainWindow: BrowserWindow | null = null;
let desktopVisualWindow: BrowserWindow | null = null;
let desktopHitboxWindow: BrowserWindow | null = null;
let nextServer: ChildProcess | null = null;
// Set to true only after the Next.js server is confirmed ready and the first
// window has been created. Guards activate/reopen handlers from firing early.
let appReady = false;
let desktopModeEnabled = false;
let normalWindowBounds: Rectangle | null = null;
let desktopPanelPosition: DesktopPanelPosition = 'bottom-right';
const DESKTOP_VISUAL_SIZE = 184;
const DESKTOP_PANEL_MARGIN = 24;
const DESKTOP_LOGO_HITBOX_SIZE = 104;
function getDesktopDisplay(): Display {
    const existingWindow = desktopVisualWindow ?? desktopHitboxWindow;
    return existingWindow
        ? screen.getDisplayMatching(existingWindow.getBounds())
        : screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
}
function getVisualBounds(position: DesktopPanelPosition): Rectangle {
    const area = getDesktopDisplay().workArea;
    const x = position === 'top-left' || position === 'bottom-left'
        ? area.x + DESKTOP_PANEL_MARGIN
        : area.x + area.width - DESKTOP_VISUAL_SIZE - DESKTOP_PANEL_MARGIN;
    const y = position === 'top-left' || position === 'top-right'
        ? area.y + DESKTOP_PANEL_MARGIN
        : area.y + area.height - DESKTOP_VISUAL_SIZE - DESKTOP_PANEL_MARGIN;
    return { x, y, width: DESKTOP_VISUAL_SIZE, height: DESKTOP_VISUAL_SIZE };
}
function getHitboxBounds(position: DesktopPanelPosition): Rectangle {
    const visual = getVisualBounds(position);
    const offset = Math.round((DESKTOP_VISUAL_SIZE - DESKTOP_LOGO_HITBOX_SIZE) / 2);
    return {
        x: visual.x + offset,
        y: visual.y + offset,
        width: DESKTOP_LOGO_HITBOX_SIZE,
        height: DESKTOP_LOGO_HITBOX_SIZE,
    };
}
function createDesktopWindow(kind: DesktopWindowKind): BrowserWindow {
    const win = new BrowserWindow({
        ...(kind === 'visual'
            ? getVisualBounds(desktopPanelPosition)
            : getHitboxBounds(desktopPanelPosition)),
        frame: false,
        transparent: true,
        backgroundColor: '#00000000',
        show: false,
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        skipTaskbar: true,
        hasShadow: false,
        alwaysOnTop: true,
        title: kind === 'visual' ? 'Jarvis Desktop Visual' : 'Jarvis Desktop Hitbox',
        icon: APP_ICON_PATH,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            webSecurity: true,
            backgroundThrottling: false,
        },
    });
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    return win;
}
function getCircularHitboxRects(): Rectangle[] {
    const rects: Rectangle[] = [];
    const radius = DESKTOP_LOGO_HITBOX_SIZE / 2;
    const step = 4;
    for (let y = 0; y < DESKTOP_LOGO_HITBOX_SIZE; y += step) {
        const yFromCenter = y + step / 2 - radius;
        const halfWidth = Math.sqrt(Math.max(0, radius * radius - yFromCenter * yFromCenter));
        rects.push({
            x: Math.round(radius - halfWidth),
            y,
            width: Math.round(halfWidth * 2),
            height: step,
        });
    }
    return rects;
}
function applyDesktopHitbox(win: BrowserWindow): void {
    if (process.platform !== 'darwin' && typeof win.setShape === 'function') {
        win.setShape(getCircularHitboxRects());
    }
    if (process.platform === 'darwin') {
        win.setIgnoreMouseEvents(true, { forward: true });
    }
}
function hitboxHtml(muted = false): string {
    return encodeURIComponent(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'self' 'unsafe-inline' data:;" />
    <style>
      html, body {
        width: 100%;
        height: 100%;
        margin: 0;
        overflow: hidden;
        background: transparent;
      }
      body {
        display: grid;
        place-items: center;
        user-select: none;
        -webkit-user-select: none;
      }
      button {
        width: ${DESKTOP_LOGO_HITBOX_SIZE}px;
        height: ${DESKTOP_LOGO_HITBOX_SIZE}px;
        padding: 0;
        border: 0;
        border-radius: 999px;
        background: transparent;
        cursor: pointer;
      }
    </style>
  </head>
  <body>
    <button id="hitbox" aria-label="${muted ? 'Unmute Jarvis' : 'Mute Jarvis'}"></button>
    <script>
      const button = document.getElementById('hitbox');
      let passthrough = true;
      const setPassthrough = (next) => {
        if (next === passthrough) return;
        passthrough = next;
        window.electron?.setDesktopPanelMousePassthrough?.(next);
      };
      if (navigator.platform.toLowerCase().includes('mac')) {
        window.electron?.setDesktopPanelMousePassthrough?.(true);
        window.addEventListener('mousemove', (event) => {
          const rect = button.getBoundingClientRect();
          const x = event.clientX - (rect.left + rect.width / 2);
          const y = event.clientY - (rect.top + rect.height / 2);
          setPassthrough(Math.hypot(x, y) > rect.width * 0.49);
        });
        window.addEventListener('mouseleave', () => setPassthrough(true));
      }
      button.addEventListener('click', () => window.electron?.overlayClick?.());
      window.electron?.onDesktopPanelMuted?.((muted) => {
        button.setAttribute('aria-label', muted ? 'Unmute Jarvis' : 'Mute Jarvis');
      });
    </script>
  </body>
</html>`);
}
function loadDesktopContent(logo: string | undefined, muted: boolean): void {
    const params = new URLSearchParams({
        logo: logo ?? 'logo',
        muted: muted ? '1' : '0',
    });
    desktopVisualWindow?.loadURL(`http://127.0.0.1:${PORT}/desktop-overlay?${params.toString()}`);
    desktopHitboxWindow?.loadURL(`data:text/html;charset=utf-8,${hitboxHtml(muted)}`);
}
function createDesktopOverlay(logo: string | undefined, muted: boolean): { visual: BrowserWindow; hitbox: BrowserWindow } {
    if (!desktopVisualWindow) {
        desktopVisualWindow = createDesktopWindow('visual');
        desktopVisualWindow.setIgnoreMouseEvents(true, { forward: true });
        desktopVisualWindow.on('closed', () => {
            desktopVisualWindow = null;
        });
    }
    if (!desktopHitboxWindow) {
        desktopHitboxWindow = createDesktopWindow('hitbox');
        applyDesktopHitbox(desktopHitboxWindow);
        desktopHitboxWindow.on('closed', () => {
            desktopHitboxWindow = null;
        });
    }
    const visual = desktopVisualWindow;
    const hitbox = desktopHitboxWindow;
    if (!visual || !hitbox) throw new Error('Desktop overlay windows could not be created.');
    loadDesktopContent(logo, muted);
    visual.once('ready-to-show', () => {
        desktopVisualWindow?.showInactive();
    });
    hitbox.once('ready-to-show', () => {
        desktopHitboxWindow?.showInactive();
        desktopHitboxWindow?.moveTop();
    });
    return { visual, hitbox };
}
function setDesktopOverlayBounds(position: DesktopPanelPosition): void {
    desktopVisualWindow?.setBounds(getVisualBounds(position));
    desktopHitboxWindow?.setBounds(getHitboxBounds(position));
    if (desktopHitboxWindow)
        applyDesktopHitbox(desktopHitboxWindow);
}
function animateWindowTo(win: BrowserWindow, to: Rectangle): void {
    const from = win.getBounds();
    const startedAt = Date.now();
    const duration = 320;
    const timer = setInterval(() => {
        if (win.isDestroyed()) {
            clearInterval(timer);
            return;
        }
        const t = Math.min(1, (Date.now() - startedAt) / duration);
        const eased = 1 - Math.pow(1 - t, 3);
        win.setBounds({
            x: Math.round(from.x + (to.x - from.x) * eased),
            y: Math.round(from.y + (to.y - from.y) * eased),
            width: to.width,
            height: to.height,
        });
        if (t >= 1)
            clearInterval(timer);
    }, 16);
}
function animateDesktopOverlayTo(position: DesktopPanelPosition): void {
    desktopPanelPosition = position;
    if (desktopVisualWindow)
        animateWindowTo(desktopVisualWindow, getVisualBounds(position));
    if (desktopHitboxWindow)
        animateWindowTo(desktopHitboxWindow, getHitboxBounds(position));
}
function closeDesktopOverlay(): void {
    desktopVisualWindow?.close();
    desktopVisualWindow = null;
    desktopHitboxWindow?.close();
    desktopHitboxWindow = null;
}
function setDesktopMode(options: DesktopModeOptions) {
    if (!mainWindow)
        return { success: false, error: 'Main window is not ready.' };
    if (options.position)
        desktopPanelPosition = options.position;
    if (options.enabled) {
        if (!desktopModeEnabled) {
            normalWindowBounds = mainWindow.getBounds();
        }
        desktopModeEnabled = true;
        mainWindow.hide();
        const overlay = createDesktopOverlay(options.logo, options.muted ?? false);
        setDesktopOverlayBounds(desktopPanelPosition);
        overlay.visual.setAlwaysOnTop(true, 'screen-saver');
        overlay.hitbox.setAlwaysOnTop(true, 'screen-saver');
        overlay.visual.showInactive();
        overlay.hitbox.showInactive();
        overlay.hitbox.moveTop();
        return { success: true, enabled: true, position: desktopPanelPosition };
    }
    desktopModeEnabled = false;
    closeDesktopOverlay();
    if (normalWindowBounds) {
        mainWindow.setBounds(normalWindowBounds);
    }
    mainWindow.show();
    mainWindow.focus();
    return { success: true, enabled: false };
}
function setupDesktopModeIpc(): void {
    ipcMain.handle('chrome-control:get-ui-token', (event) => {
        const senderUrl = event.senderFrame?.url || event.sender.getURL();
        try {
            const parsed = new URL(senderUrl);
            if (parsed.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(parsed.hostname) || parsed.port !== String(PORT)) {
                throw new Error('Chrome-control authorization is available only to the local Jarvis renderer.');
            }
            return CHROME_CONTROL_UI_TOKEN;
        }
        catch {
            throw new Error('Chrome-control authorization is available only to the local Jarvis renderer.');
        }
    });
    ipcMain.handle('desktop-control-token:get', (event) => {
        try {
            const sender = new URL(event.senderFrame?.url || event.sender.getURL());
            if (sender.protocol === 'http:' && sender.hostname === '127.0.0.1' && Number(sender.port) === PORT)
                return DESKTOP_CONTROL_TOKEN;
        }
        catch { /* Reject non-Jarvis renderer URLs below. */ }
        throw new Error('Desktop control credentials are available only to the local Jarvis renderer.');
    });
    ipcMain.handle('lan-gateway:info', (event) => {
        try {
            const sender = new URL(event.senderFrame?.url || event.sender.getURL());
            if (sender.protocol === 'http:' && sender.hostname === '127.0.0.1' && Number(sender.port) === PORT)
                return lanGateway?.info() ?? { available: false, port: HTTPS_PORT };
        }
        catch { /* Reject non-Jarvis renderer URLs below. */ }
        throw new Error('LAN gateway details are available only to the local Jarvis renderer.');
    });
    ipcMain.handle('desktop-mode:set', (_event, options: DesktopModeOptions) => {
        return setDesktopMode(options);
    });
    ipcMain.handle('desktop-mode:move', (_event, position: DesktopPanelPosition) => {
        desktopPanelPosition = position;
        animateDesktopOverlayTo(position);
        return { success: true, position };
    });
    ipcMain.on('desktop-mode:overlay-clicked', () => {
        mainWindow?.webContents.send('desktop-mode:overlay-click');
    });
    ipcMain.on('desktop-mode:muted', (_event, muted: boolean) => {
        desktopVisualWindow?.webContents.send('desktop-mode:muted', muted);
        desktopHitboxWindow?.webContents.send('desktop-mode:muted', muted);
    });
    ipcMain.on('desktop-mode:mouse-passthrough', (_event, passthrough: boolean) => {
        if (process.platform !== 'darwin')
            return;
        desktopHitboxWindow?.setIgnoreMouseEvents(passthrough, { forward: true });
    });
    ipcMain.handle('get-audio-source-id', async () => {
        try {
            const sources = await desktopCapturer.getSources({ types: ['screen'] });
            return sources[0]?.id ?? null;
        }
        catch {
            return null;
        }
    });
    ipcMain.handle('macos-permissions:get', () => getMacPermissionStatus());
    ipcMain.handle('macos-permissions:request', (_event, permission: MacPermission) => requestMacPermission(permission));
    ipcMain.handle('macos-permissions:reveal-app', () => {
        const status = getMacPermissionStatus();
        if (status.appBundlePath) {
            shell.showItemInFolder(status.appBundlePath);
        }
        return status;
    });
}
function waitForServer(retries = 40, delay = 500): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        const attempt = (n: number) => {
            const req = http.get(`http://127.0.0.1:${PORT}`, () => {
                req.destroy();
                resolve();
            });
            req.on('error', () => {
                if (n >= retries) {
                    reject(new Error(`Next.js server did not start after ${retries} attempts`));
                }
                else {
                    setTimeout(() => attempt(n + 1), delay);
                }
            });
            req.end();
        };
        attempt(0);
    });
}
function startNextServer(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        const appDir = path.join(process.resourcesPath, 'app', 'standalone');
        const serverPath = path.join(appDir, 'server.js');
        let settled = false;
        const fail = (err: Error) => {
            if (settled)
                return;
            settled = true;
            try {
                nextServer?.kill();
            }
            catch {
                /* ignore */
            }
            reject(err);
        };
        // utilityProcess is flaky on some Windows installs; run Node via Electron's binary.
        nextServer = spawn(process.execPath, [serverPath], {
            cwd: appDir,
            env: {
                ...process.env,
                ELECTRON_RUN_AS_NODE: '1',
                PORT: String(PORT),
                HOSTNAME: '127.0.0.1',
                NODE_ENV: 'production',
                NEXT_MANUAL_SIG_HANDLE: 'true',
                JARVIS_DATA_DIR: CORE_DATA_DIR,
                JARVIS_APP_VERSION: app.getVersion(),
            },
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        nextServer.stdout?.on('data', (chunk) => {
            if (isDev)
                console.log('[next]', chunk.toString());
        });
        nextServer.stderr?.on('data', (chunk) => {
            console.error('[next]', chunk.toString());
        });
        nextServer.on('error', (err) => fail(err));
        nextServer.on('exit', (code) => {
            if (settled)
                return;
            const crashed = typeof code === 'number' ? code !== 0 : true;
            if (crashed) {
                fail(new Error(`Next.js server exited unexpectedly (code: ${String(code)}). If the app never loaded, check Windows Firewall / antivirus for localhost:${PORT} — or run the installer from a local folder (not a network drive).`));
            }
        });
        waitForServer()
            .then(() => {
            if (settled)
                return;
            settled = true;
            resolve();
        })
            .catch((err) => fail(err instanceof Error ? err : new Error(String(err))));
    });
}
async function requestMediaPermissions(): Promise<void> {
    if (process.platform !== 'darwin')
        return;
    try {
        const microphoneBefore = systemPreferences.getMediaAccessStatus('microphone');
        const cameraBefore = systemPreferences.getMediaAccessStatus('camera');
        console.log(`[jarvis] Media status before request: microphone=${microphoneBefore}, camera=${cameraBefore}`);
        const microphoneGranted = await systemPreferences.askForMediaAccess('microphone');
        console.log(`[jarvis] Microphone permission result: ${String(microphoneGranted)}; status=${systemPreferences.getMediaAccessStatus('microphone')}`);
        const cameraGranted = await systemPreferences.askForMediaAccess('camera');
        console.log(`[jarvis] Camera permission result: ${String(cameraGranted)}; status=${systemPreferences.getMediaAccessStatus('camera')}`);
    }
    catch (error) {
        console.error('[jarvis] Native media permission request failed:', error);
    }
}
function getMacPermissionStatus(): MacPermissionStatus {
    if (process.platform !== 'darwin')
        return { available: false };
    return {
        available: true,
        accessibility: systemPreferences.isTrustedAccessibilityClient(false) ? 'granted' : 'denied',
        screen: systemPreferences.getMediaAccessStatus('screen'),
        microphone: systemPreferences.getMediaAccessStatus('microphone'),
        appBundlePath: path.dirname(path.dirname(path.dirname(process.execPath))),
    };
}
async function requestMacPermission(permission: MacPermission): Promise<MacPermissionStatus> {
    if (process.platform !== 'darwin')
        return { available: false };
    if (permission === 'accessibility') {
        const trusted = systemPreferences.isTrustedAccessibilityClient(true);
        if (!trusted) {
            await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility');
        }
    }
    else if (permission === 'screen') {
        await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');
    }
    else if (permission === 'microphone') {
        await systemPreferences.askForMediaAccess('microphone');
        if (systemPreferences.getMediaAccessStatus('microphone') !== 'granted') {
            await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone');
        }
    }
    return getMacPermissionStatus();
}
let lanGateway: LanGatewayController | null = null;
async function startHttpsProxy(): Promise<void> {
    try {
        lanGateway = await startLanGateway({
            internalPort: PORT,
            httpsPort: HTTPS_PORT,
            desktopToken: DESKTOP_CONTROL_TOKEN,
            userDataPath: app.getPath('userData'),
            onError: (error) => {
                const code = errorCode(error) ?? '';
                if (!['ECONNRESET', 'ECONNREFUSED', 'EPIPE'].includes(code))
                    console.error('[jarvis] LAN gateway error:', error.message);
            },
        });
        const info = lanGateway.info();
        if (info.url) console.log(`[jarvis] Paired LAN gateway: ${info.url}`);
    }
    catch (err) {
        console.error('[jarvis] Paired LAN gateway failed to start:', err);
    }
}
function createWindow(): void {
    mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        minWidth: 1024,
        minHeight: 700,
        title: 'Jarvis',
        titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
        backgroundColor: '#00000000',
        transparent: true,
        show: false,
        icon: APP_ICON_PATH,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            webSecurity: true,
            backgroundThrottling: false,
        },
    });
    mainWindow.loadURL(`http://127.0.0.1:${PORT}`);
    mainWindow.once('ready-to-show', () => {
        mainWindow?.show();
        if (isDev) {
            mainWindow?.webContents.openDevTools();
        }
    });
    // Open external links in the default browser
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        shell.openExternal(url);
        return { action: 'deny' };
    });
    mainWindow.webContents.on('will-navigate', (event, url) => {
        try {
            const destination = new URL(url);
            if (destination.protocol === 'http:' && destination.hostname === '127.0.0.1' && Number(destination.port) === PORT)
                return;
        }
        catch { /* Open malformed/external destinations outside Electron. */ }
        event.preventDefault();
        void shell.openExternal(url);
    });
    mainWindow.on('closed', () => {
        mainWindow = null;
        closeDesktopOverlay();
    });
}
function setupPermissions(): void {
    const isJarvisOrigin = (url: string) => url.startsWith('http://127.0.0.1') ||
        url.startsWith('http://localhost') ||
        url.startsWith('https://127.0.0.1') ||
        url.startsWith('https://localhost');
    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
        const url = webContents.getURL();
        if (isJarvisOrigin(url) &&
            ['media', 'microphone', 'camera', 'display-capture', 'speechRecognition', 'speech'].includes(permission)) {
            callback(true);
            return;
        }
        callback(false);
    });
    session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
        if (!webContents)
            return false;
        const url = webContents.getURL();
        if (isJarvisOrigin(url) && ['media', 'microphone', 'camera', 'speechRecognition', 'speech'].includes(permission)) {
            return true;
        }
        return false;
    });
}
app.whenReady().then(async () => {
    // Default BrowserWindow title is "Electron"; menu / Dock name in dev follows the binary unless set here.
    app.setName('Jarvis Dev');
    registerJarvisPdfProtocol();
    setupPermissions();
    setupDesktopModeIpc();
    // Do not hold the entire app startup behind a macOS privacy dialog. The
    // request continues in the background and the UI can open immediately.
    void requestMediaPermissions();
    // Ask macOS to register Jarvis in Accessibility on first launch. macOS
    // requires the user to flip the switch; this call cannot grant it silently.
    if (process.platform === 'darwin' && !systemPreferences.isTrustedAccessibilityClient(false)) {
        setTimeout(() => {
            systemPreferences.isTrustedAccessibilityClient(true);
        }, 1000);
    }
    if (isDev) {
        createWindow();
        startHttpsProxy();
    }
    else {
        try {
            await startNextServer();
            startHttpsProxy();
            createWindow();
        }
        catch (err) {
            console.error('Failed to start Next.js server:', err);
            const message = err instanceof Error
                ? err.message
                : typeof err === 'string'
                    ? err
                    : JSON.stringify(err);
            dialog.showMessageBoxSync({
                type: 'error',
                title: 'Jarvis — could not start',
                message: 'The local web server did not start, so Jarvis cannot load its interface.',
                detail: message,
            });
            app.quit();
            return;
        }
    }
    appReady = true;
});
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        nextServer?.kill();
        app.quit();
    }
});
// On macOS, clicking the dock icon re-opens the window. Only allowed once
// the full startup sequence (server + first window) has completed.
app.on('activate', () => {
    if (!appReady)
        return;
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});
app.on('before-quit', () => {
    nextServer?.kill();
    lanGateway?.close();
});
