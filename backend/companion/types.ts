export interface CompanionDevice {
  id: string;
  name: string;
  address: string;
  token: string;
  fingerprint: string;
  platform: string;
  arch: string;
  pairedAt: string;
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
  displays?: Array<{ id?: number | string; name?: string; primary?: boolean }>;
  error?: string;
}

export interface CompanionStatus {
  protocol: number;
  deviceId: string;
  deviceName: string;
  platform: string;
  arch: string;
  hostname: string;
  paused: boolean;
  screen: { width: number; height: number };
  displays: Array<{ id?: number | string; name?: string; primary?: boolean }>;
  lease: { active: boolean; controllerName?: string; expiresAt?: string };
}

export interface CompanionRemoteConfig {
  name: string;
  address: string;
  token: string;
  fingerprint: string;
  platform: string;
}
