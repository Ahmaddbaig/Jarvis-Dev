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
      getAudioSourceId?: () => Promise<string | null>;
      getMacPermissions?: () => Promise<MacPermissionStatus>;
      requestMacPermission?: (permission: 'accessibility' | 'screen' | 'microphone') => Promise<MacPermissionStatus>;
      revealMacPermissionApp?: () => Promise<MacPermissionStatus>;
      getChromeControlToken?: () => Promise<string>;
      onDesktopOverlayClick?: (callback: () => void) => () => void;
      onDesktopPanelMuted?: (callback: (muted: boolean) => void) => () => void;
    };
  }

  interface MacPermissionStatus {
    available: boolean;
    accessibility?: string;
    screen?: string;
    microphone?: string;
    appBundlePath?: string;
  }
}
