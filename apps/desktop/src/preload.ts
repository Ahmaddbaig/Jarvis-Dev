import { contextBridge, ipcRenderer } from 'electron';

type DesktopPermission = 'accessibility' | 'screen' | 'microphone';
type SocialPlatformId = 'instagram' | 'tiktok' | 'facebook' | 'youtube';
type SocialBounds = { x: number; y: number; width: number; height: number };
type TouchInputStatus = { connected: boolean; product?: string; permissionDenied?: boolean };

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
    getLanGatewayInfo: () => ipcRenderer.invoke('lan-gateway:info'),
    getAIEngineStatus: () => ipcRenderer.invoke('ai-engine:status'),
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
    getTouchInputStatus: () => ipcRenderer.invoke('touch-input:get-status') as Promise<TouchInputStatus>,
    onTouchInputStatus: (callback: (status: TouchInputStatus) => void) => {
        ipcRenderer.on('touch-input:status', (_event, status: TouchInputStatus) => callback(status));
        return () => ipcRenderer.removeAllListeners('touch-input:status');
    },
    setWindowOpaque: (opaque: boolean) => ipcRenderer.invoke('window:set-opaque', opaque) as Promise<{ success: boolean; opaque?: boolean; error?: string }>,
    socialStart: () => ipcRenderer.invoke('social:start') as Promise<{ success: boolean; error?: string }>,
    socialStop: () => ipcRenderer.invoke('social:stop') as Promise<{ success: boolean }>,
    socialSetBounds: (all: Partial<Record<SocialPlatformId, SocialBounds>>) => ipcRenderer.invoke('social:set-bounds', all),
    socialNavigate: (id: SocialPlatformId, url: string) => ipcRenderer.invoke('social:navigate', id, url),
    socialNavigateAll: (url: string) => ipcRenderer.invoke('social:navigate-all', url),
    socialReload: (id: SocialPlatformId) => ipcRenderer.invoke('social:reload', id),
    socialHome: (id: SocialPlatformId) => ipcRenderer.invoke('social:home', id),
    socialGetUrl: (id: SocialPlatformId) => ipcRenderer.invoke('social:get-url', id) as Promise<{ success: boolean; url?: string }>,
    socialCaptureHtml: (id: SocialPlatformId) => ipcRenderer.invoke('social:capture-html', id) as Promise<{ success: boolean; html?: string; url?: string; title?: string; error?: string }>,
    socialExec: (id: SocialPlatformId, code: string) => ipcRenderer.invoke('social:exec', id, code) as Promise<{ success: boolean; result?: unknown; error?: string }>,
    socialPostReply: (
        id: SocialPlatformId,
        author: string,
        commentText: string,
        reply: string,
        options?: { typingMsPerChar?: number; typingJitterMs?: number },
    ) => ipcRenderer.invoke('social:post-reply', id, author, commentText, reply, options) as Promise<{ success: boolean; error?: string }>,
};

contextBridge.exposeInMainWorld('electron', electronBridge);
