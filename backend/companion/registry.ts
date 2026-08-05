import fs from 'fs';
import path from 'path';
import type { CompanionDevice, CompanionRemoteConfig } from './types';

interface CompanionRegistry {
  version: 1;
  devices: CompanionDevice[];
}

function registryPath(): string {
  const base = process.env.JARVIS_DATA_DIR || process.cwd();
  return path.join(base, 'jarvis-companions.json');
}

export function readCompanionRegistry(): CompanionRegistry {
  try {
    const parsed = JSON.parse(fs.readFileSync(registryPath(), 'utf8')) as Partial<CompanionRegistry>;
    return {
      version: 1,
      devices: Array.isArray(parsed.devices) ? parsed.devices.filter((device) =>
        device &&
        typeof device.id === 'string' &&
        typeof device.name === 'string' &&
        typeof device.address === 'string' &&
        typeof device.token === 'string' &&
        typeof device.fingerprint === 'string'
      ) : [],
    };
  } catch {
    return { version: 1, devices: [] };
  }
}

function writeCompanionRegistry(registry: CompanionRegistry): void {
  const target = registryPath();
  const temporary = `${target}.${process.pid}.tmp`;
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  fs.writeFileSync(temporary, JSON.stringify(registry, null, 2), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporary, target);
  try { fs.chmodSync(target, 0o600); } catch { /* Windows has no POSIX file mode */ }
}

export function upsertCompanionDevice(device: CompanionDevice): CompanionDevice {
  const registry = readCompanionRegistry();
  registry.devices = registry.devices.filter((candidate) => candidate.id !== device.id && candidate.address !== device.address);
  registry.devices.push(device);
  writeCompanionRegistry(registry);
  return device;
}

export function removeCompanionDevice(id: string): boolean {
  const registry = readCompanionRegistry();
  const before = registry.devices.length;
  registry.devices = registry.devices.filter((device) => device.id !== id);
  if (registry.devices.length !== before) writeCompanionRegistry(registry);
  return registry.devices.length !== before;
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
