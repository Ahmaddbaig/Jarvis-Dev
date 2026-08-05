import { contextBridge, ipcRenderer } from 'electron';

type DesktopPermission = 'accessibility' | 'screen' | 'microphone';

const electronBridge = {
    isElectron: true,
    platform: process.platform,
    onMenuAction: (callback: (action: string) => void) => {
        ipcRenderer.on('menu-action', (_event, action: string) => callback(action));
        return () => ipcRenderer.removeAllListeners('menu-action');
    },
    setDesktopMode: (options: unknown) => ipcRenderer.invoke('desktop-mode:set', options),
    moveDesktopPanel: (position: unknown) => ipcRenderer.invoke('desktop-mode:move', position),
    setDesktopPanelMuted: (muted: boolean) => ipcRenderer.send('desktop-mode:muted', muted),
    setDesktopPanelMousePassthrough: (passthrough: boolean) => ipcRenderer.send('desktop-mode:mouse-passthrough', passthrough),
    overlayClick: () => ipcRenderer.send('desktop-mode:overlay-clicked'),
    getDesktopControlToken: () => ipcRenderer.invoke('desktop-control-token:get') as Promise<string>,
    getAudioSourceId: () => ipcRenderer.invoke('get-audio-source-id') as Promise<string | null>,
    getMacPermissions: () => ipcRenderer.invoke('macos-permissions:get'),
    requestMacPermission: (permission: DesktopPermission) => ipcRenderer.invoke('macos-permissions:request', permission),
    revealMacPermissionApp: () => ipcRenderer.invoke('macos-permissions:reveal-app'),
    getChromeControlToken: () => ipcRenderer.invoke('chrome-control:get-ui-token') as Promise<string>,
    onDesktopOverlayClick: (callback: () => void) => {
        ipcRenderer.on('desktop-mode:overlay-click', callback);
        return () => ipcRenderer.removeAllListeners('desktop-mode:overlay-click');
    },
    onDesktopPanelMuted: (callback: (muted: boolean) => void) => {
        ipcRenderer.on('desktop-mode:muted', (_event, muted: boolean) => callback(muted));
        return () => ipcRenderer.removeAllListeners('desktop-mode:muted');
    },
};

contextBridge.exposeInMainWorld('electron', electronBridge);
