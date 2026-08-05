export interface CompanionDevice {
  id: string;
  name: string;
  address: string;
  token: string;
  fingerprint: string;
  platform: string;
  arch: string;
  pairedAt: string;
  protocol?: number;
  companionVersion?: string;
  buildId?: string;
  capabilities?: string[];
}

export interface CompanionPublicDevice {
  id: string;
  name: string;
  address: string;
  platform: string;
  arch: string;
  pairedAt: string;
  online: boolean;
  paused?: boolean;
  hostname?: string;
  screen?: { width: number; height: number };
  displays?: Array<{
    id?: number | string;
    name?: string;
    primary?: boolean;
    jarvisScreen?: number;
    left?: number;
    top?: number;
    width?: number;
    height?: number;
  }>;
  error?: string;
  compatible?: boolean;
  protocol?: number;
  companionVersion?: string;
  capabilities?: string[];
}

export interface CompanionStatus {
  protocol: typeof JARVIS_REMOTE_PROTOCOL_VERSION;
  componentVersion: string;
  buildId: string;
  capabilities: string[];
  deviceId: string;
  deviceName: string;
  platform: string;
  arch: string;
  hostname: string;
  paused: boolean;
  screen: { width: number; height: number };
  displays: Array<{
    id?: number | string;
    name?: string;
    primary?: boolean;
    jarvisScreen?: number;
    left?: number;
    top?: number;
    width?: number;
    height?: number;
  }>;
  lease: { active: boolean; controllerName?: string; expiresAt?: string };
}

export interface CompanionPreview {
  mimeType: 'image/jpeg';
  width: number;
  height: number;
  displayWidth: number;
  displayHeight: number;
  screen: number;
  capturedAt: string;
  imageBase64: string;
}

export interface CompanionRemoteConfig {
  name: string;
  address: string;
  token: string;
  fingerprint: string;
  platform: string;
}
import type { JARVIS_REMOTE_PROTOCOL_VERSION } from '@jarvis/contracts';
