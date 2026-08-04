'use strict';

const path = require('path');
const { app, clipboard, dialog, Menu, nativeImage, shell, systemPreferences, Tray } = require('electron');
const { startCompanion } = require('./server.cjs');

app.setName('Jarvis Companion');
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

let tray = null;
let companion = null;
let latestInfo = null;
let quitting = false;

function setupText(info) {
  const address = info.addresses[0] ? `https://${info.addresses[0]}:${info.port}` : `https://127.0.0.1:${info.port}`;
  return [
    `Device: ${info.deviceName}`,
    `Address: ${address}`,
    `Pairing code: ${info.pairingCode}`,
    `Fingerprint: ${info.fingerprintShort}`,
  ].join('\n');
}

function refreshMenu() {
  if (!tray || !latestInfo) return;
  const address = latestInfo.addresses[0]
    ? `${latestInfo.addresses[0]}:${latestInfo.port}`
    : `127.0.0.1:${latestInfo.port}`;
  const stateLabel = latestInfo.paused
    ? 'CONTROL PAUSED'
    : latestInfo.controllerName
      ? `CONTROLLED BY ${latestInfo.controllerName}`
      : 'READY FOR JARVIS';
  tray.setToolTip(`Jarvis Companion — ${latestInfo.paused ? 'Paused' : latestInfo.controllerName ? 'Controlled' : 'Ready'}`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: stateLabel, enabled: false },
    { label: latestInfo.deviceName, enabled: false },
    { label: address, enabled: false },
    { type: 'separator' },
    { label: `Pairing code: ${latestInfo.pairingCode}`, enabled: false },
    { label: `Fingerprint: ${latestInfo.fingerprintShort}`, enabled: false },
    {
      label: 'Copy pairing information',
      click: () => clipboard.writeText(setupText(latestInfo)),
    },
    { type: 'separator' },
    {
      label: latestInfo.paused ? 'Resume control' : 'Emergency stop / pause control',
      click: () => companion?.setPaused(!latestInfo.paused),
    },
    ...(process.platform === 'darwin'
      ? [
          {
            label: 'Open Accessibility settings',
            click: () => shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'),
          },
          {
            label: 'Open Screen Recording settings',
            click: () => shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'),
          },
        ]
      : []),
    { type: 'separator' },
    {
      label: 'Quit Jarvis Companion',
      click: () => {
        quitting = true;
        app.quit();
      },
    },
  ]));
}

app.whenReady().then(async () => {
  if (process.platform === 'darwin') app.dock?.hide();
  const iconPath = path.join(__dirname, '..', '..', 'buildfiles', 'icon.png');
  let icon = nativeImage.createFromPath(iconPath);
  if (process.platform === 'darwin' && !icon.isEmpty()) icon = icon.resize({ width: 18, height: 18 });
  tray = new Tray(icon);
  tray.on('click', () => refreshMenu());

  if (process.platform === 'darwin' && !systemPreferences.isTrustedAccessibilityClient(false)) {
    systemPreferences.isTrustedAccessibilityClient(true);
  }

  try {
    companion = await startCompanion({
      dataDir: process.env.JARVIS_COMPANION_DATA_DIR || app.getPath('userData'),
      onStateChange: (info) => {
        latestInfo = info;
        refreshMenu();
      },
    });
    latestInfo = companion.getInfo();
    refreshMenu();
    if (process.env.JARVIS_COMPANION_QUIET !== '1') {
      dialog.showMessageBox({
        type: 'info',
        title: 'Jarvis Companion is ready',
        message: 'Use this information once in Jarvis → Settings → Computers.',
        detail: setupText(latestInfo),
        buttons: ['Copy and close', 'Close'],
      }).then((result) => {
        if (result.response === 0) clipboard.writeText(setupText(latestInfo));
      });
    }
  } catch (error) {
    dialog.showErrorBox('Jarvis Companion could not start', error instanceof Error ? error.message : String(error));
    quitting = true;
    app.quit();
  }
});

app.on('window-all-closed', (event) => event.preventDefault());
app.on('before-quit', (event) => {
  if (!quitting) {
    quitting = true;
    event.preventDefault();
    Promise.resolve(companion?.stop()).finally(() => app.quit());
  }
});
