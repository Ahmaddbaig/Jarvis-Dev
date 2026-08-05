/**
 * Bambu Lab Cloud MQTT manager — module-level singleton so the connection
 * persists across hot-reloads in Next.js dev and across route invocations.
 * Tokens are persisted in the operating-system vault so they survive restarts
 * without appearing in application files or renderer state.
 */

import fs from 'fs';
import path from 'path';
import { migrateLegacyJson } from '@jarvis/persistence';
import { getCoreStore } from '../persistence/core-store';
import {
  getCredentialService,
  type VaultSecretDefinition,
} from '../secrets/credential-service';

const BAMBU_API  = 'https://api.bambulab.com';
const TOKEN_PATH = path.join(process.env.JARVIS_DATA_DIR || process.cwd(), '.bambu-token.json');
export const BAMBU_TOKEN_SECRET: VaultSecretDefinition = {
  id: 'credential.bambu.session-token',
  integration: 'bambu',
  account: 'bambu.session-token',
};

export interface BambuToken {
  accessToken: string;
  refreshToken: string;
  tokenExpiration: number;
}

export interface PrinterInfo {
  deviceId: string;
  name: string;
  model?: string;
}

// ── Vault persistence and legacy migration ───────────────────────────────────

export function parseBambuToken(value: unknown): BambuToken {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Bambu token must be an object.');
  }
  const candidate = value as Partial<BambuToken>;
  if (typeof candidate.accessToken !== 'string' || !candidate.accessToken) {
    throw new Error('Bambu access token is missing.');
  }
  if (typeof candidate.refreshToken !== 'string') {
    throw new Error('Bambu refresh token is invalid.');
  }
  if (typeof candidate.tokenExpiration !== 'number' || !Number.isFinite(candidate.tokenExpiration)) {
    throw new Error('Bambu token expiration is invalid.');
  }
  return {
    accessToken: candidate.accessToken,
    refreshToken: candidate.refreshToken,
    tokenExpiration: candidate.tokenExpiration,
  };
}

function migrateLegacyToken(): void {
  const store = getCoreStore();
  const credentials = getCredentialService();
  const result = migrateLegacyJson({
    database: store.database,
    sourceId: 'bambu-token-v1',
    sourcePath: TOKEN_PATH,
    backupDirectory: path.join(store.dataDirectory, 'migration-backups'),
    quarantineDirectory: path.join(store.dataDirectory, 'migration-quarantine'),
    importRecord: (record) => {
      const token = parseBambuToken(record);
      credentials.setSecret(BAMBU_TOKEN_SECRET, JSON.stringify(token), { kind: 'session-token' });
    },
  });
  if (result.state === 'imported' && fs.existsSync(TOKEN_PATH)) fs.unlinkSync(TOKEN_PATH);
}

function loadTokenFromVault(): BambuToken | null {
  try {
    migrateLegacyToken();
    const raw = getCredentialService().getSecret(BAMBU_TOKEN_SECRET);
    return raw ? parseBambuToken(JSON.parse(raw) as unknown) : null;
  } catch {}
  return null;
}

function saveTokenToVault(token: BambuToken | null): void {
  const credentials = getCredentialService();
  if (token) {
    credentials.setSecret(BAMBU_TOKEN_SECRET, JSON.stringify(parseBambuToken(token)), { kind: 'session-token' });
  } else {
    credentials.deleteSecret(BAMBU_TOKEN_SECRET);
  }
}

// ── Global module-level state ─────────────────────────────────────────────────

const g = globalThis as typeof globalThis & {
  _bambuToken?: BambuToken | null;
  _bambuPrinters?: PrinterInfo[];
  _bambuTelemetry?: Record<string, Record<string, unknown>>;
  _bambuMqttConnected?: boolean;
  _bambuMqttClient?: import('mqtt').MqttClient | null;
  _bambuConnecting?: boolean;
  _bambuInitialized?: boolean;
  _bambuLastErrLog?: number;
};

// Route modules are evaluated during `next build`; persistence and OS-vault
// access must therefore remain lazy until a real request reaches this manager.
function ensureInitialized(): void {
  if (g._bambuInitialized) return;
  g._bambuInitialized   = true;
  g._bambuPrinters      = [];
  g._bambuTelemetry     = {};
  g._bambuMqttConnected = false;
  g._bambuMqttClient    = null;
  g._bambuConnecting    = false;
  g._bambuLastErrLog    = 0;

  const storedToken = loadTokenFromVault();
  if (storedToken && storedToken.accessToken && storedToken.tokenExpiration > Date.now()) {
    g._bambuToken = storedToken;
    // Kick off MQTT reconnection in background
    import('./mqtt-manager').then(({ connectMqtt }) => {
      connectMqtt(storedToken).catch((e) => console.error('[Bambu] Auto-reconnect failed:', e));
    });
  } else {
    g._bambuToken = null;
  }
}

export function getToken(): BambuToken | null {
  ensureInitialized();
  return g._bambuToken ?? null;
}

export function getPrinters(): PrinterInfo[] {
  ensureInitialized();
  return g._bambuPrinters ?? [];
}

export function getTelemetry(): Record<string, Record<string, unknown>> {
  ensureInitialized();
  return g._bambuTelemetry ?? {};
}

export function isMqttConnected(): boolean {
  ensureInitialized();
  return g._bambuMqttConnected ?? false;
}

export function setToken(t: BambuToken | null) {
  ensureInitialized();
  const normalized = t ? parseBambuToken(t) : null;
  saveTokenToVault(normalized);
  g._bambuToken = normalized;
}

export function isTokenValid(): boolean {
  ensureInitialized();
  return !!(g._bambuToken?.accessToken && (g._bambuToken.tokenExpiration ?? 0) > Date.now());
}

// ── Cloud MQTT ────────────────────────────────────────────────────────────────

export async function connectMqtt(token: BambuToken): Promise<void> {
  ensureInitialized();
  if (g._bambuMqttConnected && g._bambuMqttClient?.connected) return;
  if (g._bambuConnecting) return;
  g._bambuConnecting = true;

  // Fetch bound printers
  const bindRes = await fetch(`${BAMBU_API}/v1/iot-service/api/user/bind`, {
    headers: { Authorization: `Bearer ${token.accessToken}`, Accept: 'application/json' },
  });
  if (!bindRes.ok) throw new Error(`Bind failed: ${bindRes.status}`);
  const bindData = await bindRes.json() as { devices?: Array<{ dev_id: string; name: string; dev_product_name?: string }> };
  const printers: PrinterInfo[] = (bindData.devices ?? []).map((d) => ({
    deviceId: d.dev_id,
    name: d.name,
    model: d.dev_product_name,
  }));
  g._bambuPrinters = printers;

  if (!printers.length) return;

  // Resolve MQTT username from preferences
  let username = '';
  try {
    const prefRes = await fetch(`${BAMBU_API}/v1/design-user-service/my/preference`, {
      headers: { Authorization: `Bearer ${token.accessToken}` },
    });
    if (prefRes.ok) {
      const pref = await prefRes.json() as { uid?: string | number };
      if (pref.uid) username = `u_${pref.uid}`;
    }
  } catch {}
  if (!username) username = `u_${Math.random().toString(16).slice(2)}`;

  const mqtt = await import('mqtt');
  const brokerUrl = 'mqtts://us.mqtt.bambulab.com:8883';
  const client = mqtt.connect(brokerUrl, {
    clientId: username,
    username,
    password: token.accessToken,
    clean: true,
    reconnectPeriod: 5000,
    protocol: 'mqtts',
  });

  client.on('connect', () => {
    g._bambuMqttConnected = true;
    g._bambuConnecting    = false;
    printers.forEach(({ deviceId }) => {
      client.subscribe(`device/${deviceId}/report`, () => {
        const seq = Date.now().toString();
        client.publish(`device/${deviceId}/request`, JSON.stringify({
          pushing: { sequence_id: seq, command: 'pushall', version: 1, push_target: 1 },
        }));
      });
    });
  });

  client.on('message', (topic: string, buf: Buffer) => {
    try {
      const msg = JSON.parse(buf.toString()) as Record<string, unknown>;
      const id = topic.split('/')[1];
      const update = (msg.print ?? msg) as Record<string, unknown>;
      g._bambuTelemetry![id] = Object.assign({}, g._bambuTelemetry![id] ?? {}, update);
    } catch {}
  });

  client.on('error', (err: Error) => {
    const now = Date.now();
    if ((now - (g._bambuLastErrLog ?? 0)) > 30_000) {
      console.error('[Bambu MQTT]', err.message);
      g._bambuLastErrLog = now;
    }
  });
  client.on('close', () => {
    g._bambuMqttConnected = false;
    g._bambuConnecting    = false;
  });

  g._bambuMqttClient = client;
}

export function sendCommand(deviceId: string, command: 'pause' | 'resume' | 'stop'): boolean {
  ensureInitialized();
  const client = g._bambuMqttClient;
  if (!client?.connected) return false;
  const seq = Date.now().toString();
  client.publish(`device/${deviceId}/request`, JSON.stringify({
    print: { sequence_id: seq, command, param: '' },
  }), { qos: 1 });
  return true;
}

export async function fetchPrintersRest(token: BambuToken): Promise<PrinterInfo[]> {
  const res = await fetch(`${BAMBU_API}/v1/iot-service/api/user/bind`, {
    headers: { Authorization: `Bearer ${token.accessToken}`, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`${res.status}`);
  const data = await res.json() as { devices?: Array<{ dev_id: string; name: string; dev_product_name?: string }> };
  return (data.devices ?? []).map((d) => ({ deviceId: d.dev_id, name: d.name, model: d.dev_product_name }));
}
