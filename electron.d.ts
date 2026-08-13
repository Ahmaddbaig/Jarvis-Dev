export {};

declare global {
  interface Window {
    electron?: {
      isElectron: boolean;
      platform: string;
      onMenuAction?: (callback: (action: string) => void) => () => void;
      setDesktopMode: (options: unknown) => Promise<unknown>;
      moveDesktopPanel: (position: unknown) => Promise<unknown>;
      setDesktopPanelMuted?: (muted: boolean) => void;
      setDesktopPanelMousePassthrough?: (passthrough: boolean) => void;
      overlayClick?: () => void;
      getDesktopControlToken?: () => Promise<string>;
      getLanGatewayInfo?: () => Promise<{
        available: boolean;
        url?: string;
        pairingUrl?: string;
        port: number;
      }>;
      getAIEngineStatus?: () => Promise<{
        state: 'stopped' | 'starting' | 'ready' | 'restarting' | 'unavailable';
        protocol?: string;
        buildSha?: string;
        processId?: number;
        port?: number;
        restarts?: number;
        error?: string;
      }>;
      getAudioSourceId?: () => Promise<string | null>;
      getMacPermissions?: () => Promise<MacPermissionStatus>;
      requestMacPermission?: (permission: 'accessibility' | 'screen' | 'microphone') => Promise<MacPermissionStatus>;
      revealMacPermissionApp?: () => Promise<MacPermissionStatus>;
      getChromeControlToken?: () => Promise<string>;
      onDesktopOverlayClick?: (callback: () => void) => () => void;
      onDesktopPanelMuted?: (callback: (muted: boolean) => void) => () => void;
      /** Absent in this fork (the account/cloud system is not ported); typed so optional-chained callers compile. */
      cloud?: {
        voiceToken: () => Promise<{ ok: boolean; status: number; data: unknown; error?: string }>;
        voiceHeartbeat?: (minutes?: number) => Promise<{ ok: boolean; status: number; data: unknown; error?: string }>;
      };
      getTouchInputStatus?: () => Promise<TouchInputStatus>;
      onTouchInputStatus?: (callback: (status: TouchInputStatus) => void) => () => void;
      setWindowOpaque?: (opaque: boolean) => Promise<{ success: boolean; opaque?: boolean; error?: string }>;
      socialStart?: () => Promise<{ success: boolean; error?: string }>;
      socialStop?: () => Promise<{ success: boolean }>;
      socialSetBounds?: (all: Partial<Record<SocialPlatformId, SocialBounds>>) => Promise<{ success: boolean }>;
      socialNavigate?: (id: SocialPlatformId, url: string) => Promise<{ success: boolean; error?: string }>;
      socialNavigateAll?: (url: string) => Promise<{ success: boolean }>;
      socialReload?: (id: SocialPlatformId) => Promise<{ success: boolean }>;
      socialHome?: (id: SocialPlatformId) => Promise<{ success: boolean }>;
      socialGetUrl?: (id: SocialPlatformId) => Promise<{ success: boolean; url?: string }>;
      socialCaptureHtml?: (id: SocialPlatformId) => Promise<{ success: boolean; html?: string; url?: string; title?: string; error?: string }>;
      socialExec?: (id: SocialPlatformId, code: string) => Promise<{ success: boolean; result?: unknown; error?: string }>;
      socialPostReply?: (
        id: SocialPlatformId,
        author: string,
        commentText: string,
        reply: string,
        options?: { typingMsPerChar?: number; typingJitterMs?: number },
      ) => Promise<{ success: boolean; error?: string }>;
    };
  }

  type SocialPlatformId = 'instagram' | 'tiktok' | 'facebook' | 'youtube';

  interface SocialBounds {
    x: number;
    y: number;
    width: number;
    height: number;
  }

  interface TouchInputStatus {
    connected: boolean;
    product?: string;
    permissionDenied?: boolean;
  }

  interface MacPermissionStatus {
    available: boolean;
    accessibility?: string;
    screen?: string;
    microphone?: string;
    appBundlePath?: string;
  }
}
