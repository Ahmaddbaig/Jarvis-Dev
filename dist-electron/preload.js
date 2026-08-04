"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
electron_1.contextBridge.exposeInMainWorld('electron', {
    isElectron: true,
    platform: process.platform,
    onMenuAction: (callback) => {
        electron_1.ipcRenderer.on('menu-action', (_event, action) => callback(action));
        return () => electron_1.ipcRenderer.removeAllListeners('menu-action');
    },
    setDesktopMode: (options) => electron_1.ipcRenderer.invoke('desktop-mode:set', options),
    moveDesktopPanel: (position) => electron_1.ipcRenderer.invoke('desktop-mode:move', position),
    setDesktopPanelMuted: (muted) => electron_1.ipcRenderer.send('desktop-mode:muted', muted),
    setDesktopPanelMousePassthrough: (passthrough) => electron_1.ipcRenderer.send('desktop-mode:mouse-passthrough', passthrough),
    overlayClick: () => electron_1.ipcRenderer.send('desktop-mode:overlay-clicked'),
    getAudioSourceId: () => electron_1.ipcRenderer.invoke('get-audio-source-id'),
    getMacPermissions: () => electron_1.ipcRenderer.invoke('macos-permissions:get'),
    requestMacPermission: (permission) => electron_1.ipcRenderer.invoke('macos-permissions:request', permission),
    revealMacPermissionApp: () => electron_1.ipcRenderer.invoke('macos-permissions:reveal-app'),
    getChromeControlToken: () => electron_1.ipcRenderer.invoke('chrome-control:get-ui-token'),
    onDesktopOverlayClick: (callback) => {
        electron_1.ipcRenderer.on('desktop-mode:overlay-click', callback);
        return () => electron_1.ipcRenderer.removeAllListeners('desktop-mode:overlay-click');
    },
    onDesktopPanelMuted: (callback) => {
        electron_1.ipcRenderer.on('desktop-mode:muted', (_event, muted) => callback(muted));
        return () => electron_1.ipcRenderer.removeAllListeners('desktop-mode:muted');
    },
});
//# sourceMappingURL=preload.js.map
