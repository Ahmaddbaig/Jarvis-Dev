import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { migrateLegacyJson } from '@jarvis/persistence';
import { getCoreStore } from '../persistence/core-store';
import {
  getCredentialService,
  type VaultSecretDefinition,
} from '../secrets/credential-service';
import type { CompanionDevice, CompanionRemoteConfig } from './types';

interface LegacyCompanionRegistry {
  version: 1;
  devices: CompanionDevice[];
}

interface StoredCompanionDevice {
  id: string;
  name: string;
  address: string;
  fingerprint: string;
  platform: string;
  arch: string;
  pairedAt: string;
  protocol?: number;
  companionVersion?: string;
  buildId?: string;
  capabilities?: string[];
}

let legacyRegistryChecked = false;

function registryPath(): string {
  const base = process.env.JARVIS_DATA_DIR || process.cwd();
  return path.join(base, 'jarvis-companions.json');
}

export function companionTokenSecret(deviceId: string): VaultSecretDefinition {
  const digest = crypto.createHash('sha256').update(deviceId, 'utf8').digest('hex');
  return {
    id: `credential.companion.${digest}`,
    integration: 'companion',
    account: `companion.${digest}.bearer-token`,
  };
}

function parseLegacyDevice(value: unknown): CompanionDevice {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Companion device must be an object.');
  }
  const device = value as Partial<CompanionDevice>;
  for (const key of ['id', 'name', 'address', 'token', 'fingerprint', 'platform', 'arch', 'pairedAt'] as const) {
    if (typeof device[key] !== 'string' || !device[key]) {
      throw new Error(`Companion device ${key} is missing.`);
    }
  }
  return device as CompanionDevice;
}

function storedDevice(device: CompanionDevice): StoredCompanionDevice {
  return {
    id: device.id,
    name: device.name,
    address: device.address,
    fingerprint: device.fingerprint,
    platform: device.platform,
    arch: device.arch,
    pairedAt: device.pairedAt,
    protocol: device.protocol,
    companionVersion: device.companionVersion,
    buildId: device.buildId,
    capabilities: device.capabilities,
  };
}

function writeSanitizedLegacyRegistry(devices: readonly CompanionDevice[]): void {
  const target = registryPath();
  if (!fs.existsSync(target)) return;
  const temporary = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify({
    version: 1,
    devices: devices.map(storedDevice),
  }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporary, target);
  try { fs.chmodSync(target, 0o600); } catch { /* Windows has no POSIX file mode */ }
}

function putMetadata(device: StoredCompanionDevice): void {
  const store = getCoreStore();
  store.database.devices.put({
    id: device.id,
    kind: 'companion',
    friendlyName: device.name,
    platform: device.platform,
    metadata: {
      address: device.address,
      arch: device.arch,
      protocol: device.protocol ?? 0,
      companionVersion: device.companionVersion ?? 'legacy',
      buildId: device.buildId ?? 'legacy',
      capabilities: device.capabilities ?? [],
    },
  });
  store.database.pairings.put({
    id: `companion:${device.id}`,
    deviceId: device.id,
    certificateFingerprint: device.fingerprint,
    state: 'paired',
    pairedAt: device.pairedAt,
    metadata: { protocol: device.protocol ?? 0 },
  });
}

function migrateLegacyRegistry(): void {
  if (legacyRegistryChecked) return;
  const store = getCoreStore();
  const credentials = getCredentialService();
  const result = migrateLegacyJson({
    database: store.database,
    sourceId: 'jarvis-companions-v1',
    sourcePath: registryPath(),
    backupDirectory: path.join(store.dataDirectory, 'migration-backups'),
    quarantineDirectory: path.join(store.dataDirectory, 'migration-quarantine'),
    importRecord: (record) => {
      if (!Array.isArray(record.devices)) throw new Error('Companion registry devices must be an array.');
      const devices = record.devices.map(parseLegacyDevice);
      const previous = new Map<string, string | null>();
      const written: VaultSecretDefinition[] = [];
      try {
        for (const device of devices) {
          const definition = companionTokenSecret(device.id);
          previous.set(definition.id, credentials.getSecret(definition));
          credentials.setSecret(definition, device.token, { deviceId: device.id, kind: 'bearer-token' });
          written.push(definition);
          putMetadata(storedDevice(device));
        }
      } catch (error) {
        for (const definition of written.reverse()) {
          const oldValue = previous.get(definition.id);
          if (oldValue === null || oldValue === undefined) credentials.deleteSecret(definition);
          else credentials.setSecret(definition, oldValue, { kind: 'bearer-token' });
        }
        throw error;
      }
    },
  });

  if (result.state === 'imported' && !result.alreadyProcessed) {
    const devices = readDatabaseRegistry().devices;
    writeSanitizedLegacyRegistry(devices);
  }
  legacyRegistryChecked = true;
}

function requiredMetadata(metadata: Readonly<Record<string, unknown>>, key: 'address' | 'arch'): string {
  const value = metadata[key];
  if (typeof value !== 'string' || !value) throw new Error(`Companion metadata ${key} is missing.`);
  return value;
}

function optionalString(metadata: Readonly<Record<string, unknown>>, key: string): string | undefined {
  const value = metadata[key];
  return typeof value === 'string' && value ? value : undefined;
}

function optionalCapabilities(metadata: Readonly<Record<string, unknown>>): string[] | undefined {
  const value = metadata.capabilities;
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').slice(0, 100) : undefined;
}

function readDatabaseRegistry(): LegacyCompanionRegistry {
  const store = getCoreStore();
  const credentials = getCredentialService();
  const pairings = new Map(
    store.database.pairings.list('paired')
      .filter((pairing) => pairing.id.startsWith('companion:'))
      .map((pairing) => [pairing.deviceId, pairing]),
  );
  const devices = store.database.devices.list('companion').flatMap((device): CompanionDevice[] => {
    const pairing = pairings.get(device.id);
    if (!pairing?.certificateFingerprint || !pairing.pairedAt || !device.platform) return [];
    const token = credentials.getSecret(companionTokenSecret(device.id));
    if (!token) return [];
    return [{
      id: device.id,
      name: device.friendlyName,
      address: requiredMetadata(device.metadata, 'address'),
      token,
      fingerprint: pairing.certificateFingerprint,
      platform: device.platform,
      arch: requiredMetadata(device.metadata, 'arch'),
      pairedAt: pairing.pairedAt,
      protocol: typeof device.metadata.protocol === 'number' ? device.metadata.protocol : undefined,
      companionVersion: optionalString(device.metadata, 'companionVersion'),
      buildId: optionalString(device.metadata, 'buildId'),
      capabilities: optionalCapabilities(device.metadata),
    }];
  });
  return { version: 1, devices };
}

export function readCompanionRegistry(): LegacyCompanionRegistry {
  migrateLegacyRegistry();
  return readDatabaseRegistry();
}

export function upsertCompanionDevice(device: CompanionDevice): CompanionDevice {
  migrateLegacyRegistry();
  const credentials = getCredentialService();
  const definition = companionTokenSecret(device.id);
  const previous = credentials.getSecret(definition);
  credentials.setSecret(definition, device.token, { deviceId: device.id, kind: 'bearer-token' });
  try {
    getCoreStore().database.transaction(() => putMetadata(storedDevice(device)));
  } catch (error) {
    if (previous === null) credentials.deleteSecret(definition);
    else credentials.setSecret(definition, previous, { deviceId: device.id, kind: 'bearer-token' });
    throw error;
  }

  for (const duplicate of readDatabaseRegistry().devices) {
    if (duplicate.id !== device.id && duplicate.address === device.address) removeCompanionDevice(duplicate.id);
  }
  return device;
}

export function removeCompanionDevice(id: string): boolean {
  migrateLegacyRegistry();
  const store = getCoreStore();
  const existed = store.database.devices.get(id)?.kind === 'companion';
  if (!existed) return false;
  getCredentialService().deleteSecret(companionTokenSecret(id));
  store.database.devices.delete(id);
  return true;
}

export function resolveCompanionDevice(requestedTarget: string): CompanionDevice | null {
  const devices = readCompanionRegistry().devices;
  const requested = requestedTarget.trim().toLowerCase();
  if (!requested) return null;
  const exact = devices.find((device) => device.id.toLowerCase() === requested || device.name.toLowerCase() === requested);
  if (exact) return exact;

  const platformAliases: Record<string, string> = {
    windows: 'win32', pc: 'win32', mac: 'darwin', macos: 'darwin', linux: 'linux',
  };
  const platform = platformAliases[requested];
  if (platform) {
    const matches = devices.filter((device) => device.platform === platform);
    return matches.length === 1 ? matches[0] : null;
  }

  const partial = devices.filter((device) => device.name.toLowerCase().includes(requested));
  return partial.length === 1 ? partial[0] : null;
}

export function companionRemoteConfig(device: CompanionDevice): CompanionRemoteConfig {
  return {
    name: device.name,
    address: device.address,
    token: device.token,
    fingerprint: device.fingerprint,
    platform: device.platform,
  };
}
