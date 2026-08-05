export const CHROME_CONTROL_ACTIONS = [
  'status',
  'list_tabs',
  'search',
  'open_tab',
  'switch_tab',
  'close_tab',
  'navigate',
  'back',
  'forward',
  'reload',
  'read_page',
  'screenshot',
  'click',
  'type',
  'press_key',
  'scroll',
  'find',
  'get_selected_text',
] as const;

export type ChromeControlAction = (typeof CHROME_CONTROL_ACTIONS)[number];

export interface ChromeControlCommand {
  id: string;
  action: ChromeControlAction;
  args: Record<string, unknown>;
  createdAt: string;
}

export interface ChromeControlResult {
  commandId: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}

export interface ChromeControlStatus {
  paired: boolean;
  connected: boolean;
  extensionName?: string;
  extensionId?: string;
  pairedAt?: string;
  lastSeen?: string;
  extensionPath: string;
  supportedEndpoints: string[];
}
