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
      getAudioSourceId?: () => Promise<string | null>;
      onDesktopOverlayClick?: (callback: () => void) => () => void;
      onDesktopPanelMuted?: (callback: (muted: boolean) => void) => () => void;
    };
  }
}
