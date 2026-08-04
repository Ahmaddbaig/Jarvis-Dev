import crypto from 'crypto';
import dns from 'dns/promises';
import net from 'net';
import os from 'os';
import tls from 'tls';
import {
  readCompanionRegistry,
  removeCompanionDevice,
  resolveCompanionDevice,
  upsertCompanionDevice,
} from './registry';
import type {
  CompanionDevice,
  CompanionPublicDevice,
  CompanionStatus,
} from './types';

const DEFAULT_PORT = 45831;
const MAX_RESPONSE_BYTES = 20 * 1024 * 1024;

interface CompanionResponse<T> {
  status: number;
  data: T;
  fingerprint: string;
}

function isPrivateIp(address: string): boolean {
  if (net.isIPv4(address)) {
    const octets = address.split('.').map(Number);
    return octets[0] === 10 ||
      octets[0] === 127 ||
      (octets[0] === 169 && octets[1] === 254) ||
      (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
      (octets[0] === 192 && octets[1] === 168);
  }
  if (net.isIPv6(address)) {
    const normalized = address.toLowerCase();
    return normalized === '::1' || normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe80:');
  }
  return false;
}

function normalizeFingerprint(value: string): string {
  return value.toLowerCase().replace(/[^a-f0-9]/g, '');
}

export function normalizeCompanionAddress(raw: string): string {
  const withScheme = /^[a-z]+:\/\//i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`;
  const url = new URL(withScheme);
  if (url.protocol !== 'https:') throw new Error('Companion addresses must use HTTPS.');
  if (url.username || url.password || url.search || url.hash || (url.pathname && url.pathname !== '/')) {
    throw new Error('Use only the companion host and port, for example https://192.168.1.20:45831.');
  }
  if (!url.port) url.port = String(DEFAULT_PORT);
  return `${url.protocol}//${url.hostname}${url.port ? `:${url.port}` : ''}`;
}

async function resolveLanHost(hostname: string): Promise<string> {
  const records = await dns.lookup(hostname, { all: true, verbatim: true });
  if (records.length === 0 || records.some((record) => !isPrivateIp(record.address))) {
    throw new Error('Companion addresses must resolve only to this computer or a private LAN address.');
  }
  return records[0].address;
}

function parseHttpResponse<T>(raw: Buffer): { status: number; data: T } {
  const separator = raw.indexOf('\r\n\r\n');
  if (separator < 0) throw new Error('Companion returned an invalid HTTP response.');
  const headers = raw.subarray(0, separator).toString('utf8');
  const statusMatch = headers.match(/^HTTP\/1\.[01]\s+(\d{3})/);
  if (!statusMatch) throw new Error('Companion returned an invalid HTTP status.');
  const body = raw.subarray(separator + 4).toString('utf8');
  try {
    return { status: Number(statusMatch[1]), data: JSON.parse(body) as T };
  } catch {
    throw new Error('Companion returned invalid JSON.');
  }
}

async function companionRequest<T>(
  address: string,
  method: 'GET' | 'POST',
  pathname: string,
  options: { token?: string; leaseToken?: string; body?: unknown; fingerprint: string }
): Promise<CompanionResponse<T>> {
  const normalized = normalizeCompanionAddress(address);
  const url = new URL(normalized);
  const resolvedAddress = await resolveLanHost(url.hostname);
  const expectedFingerprint = normalizeFingerprint(options.fingerprint);
  if (expectedFingerprint.length < 16) throw new Error('Enter at least the 16-character fingerprint shown by the companion.');

  return await new Promise<CompanionResponse<T>>((resolve, reject) => {
    let settled = false;
    const finishError = (error: unknown) => {
      if (settled) return;
      settled = true;
      reject(error instanceof Error ? error : new Error(String(error)));
    };
    const socket = tls.connect({
      host: resolvedAddress,
      port: Number(url.port),
      servername: net.isIP(url.hostname) ? undefined : url.hostname,
      rejectUnauthorized: false,
      minVersion: 'TLSv1.2',
    });
    socket.setTimeout(15_000, () => socket.destroy(new Error('Companion request timed out.')));
    const chunks: Buffer[] = [];
    let size = 0;

    socket.once('secureConnect', () => {
      const certificate = socket.getPeerCertificate(true);
      if (!certificate.raw) {
        socket.destroy(new Error('Companion did not provide a certificate.'));
        return;
      }
      const actualFingerprint = crypto.createHash('sha256').update(certificate.raw).digest('hex');
      if (!actualFingerprint.startsWith(expectedFingerprint)) {
        socket.destroy(new Error('Companion certificate fingerprint does not match. Check the value shown on the companion computer.'));
        return;
      }
      const body = options.body === undefined ? '' : JSON.stringify(options.body);
      const headers = [
        `${method} ${pathname} HTTP/1.1`,
        `Host: ${url.host}`,
        'Accept: application/json',
        'Connection: close',
        ...(options.token ? [`Authorization: Bearer ${options.token}`] : []),
        ...(options.leaseToken ? [`X-Jarvis-Lease: ${options.leaseToken}`] : []),
        ...(body ? ['Content-Type: application/json', `Content-Length: ${Buffer.byteLength(body)}`] : ['Content-Length: 0']),
        '',
        body,
      ];
      socket.write(headers.join('\r\n'));
    });
    socket.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_RESPONSE_BYTES) {
        socket.destroy(new Error('Companion response exceeded the size limit.'));
        return;
      }
      chunks.push(chunk);
    });
    socket.on('error', finishError);
    socket.on('end', () => {
      if (settled) return;
      try {
        const parsed = parseHttpResponse<T>(Buffer.concat(chunks));
        const certificate = socket.getPeerCertificate(true);
        const fingerprint = crypto.createHash('sha256').update(certificate.raw).digest('hex');
        settled = true;
        resolve({ ...parsed, fingerprint });
      } catch (error) {
        finishError(error);
      }
    });
  });
}

function assertSuccess<T extends { error?: string }>(response: CompanionResponse<T>): T {
  if (response.status < 200 || response.status >= 300) {
    throw new Error(response.data?.error || `Companion request failed with HTTP ${response.status}.`);
  }
  return response.data;
}

export async function pairCompanion(input: {
  address: string;
  code: string;
  fingerprint: string;
}): Promise<CompanionDevice> {
  const address = normalizeCompanionAddress(input.address);
  const fingerprint = normalizeFingerprint(input.fingerprint);
  const identityResponse = await companionRequest<{
    deviceId: string;
    deviceName: string;
    platform: string;
    arch: string;
    fingerprint: string;
    error?: string;
  }>(address, 'GET', '/v1/identity', { fingerprint });
  const identity = assertSuccess(identityResponse);
  if (normalizeFingerprint(identity.fingerprint) !== identityResponse.fingerprint) {
    throw new Error('Companion identity fingerprint did not match its TLS certificate.');
  }
  const pairedResponse = await companionRequest<{
    token: string;
    deviceId: string;
    deviceName: string;
    platform: string;
    arch: string;
    fingerprint: string;
    error?: string;
  }>(address, 'POST', '/v1/pair', {
    fingerprint: identityResponse.fingerprint,
    body: { code: input.code.trim(), controllerName: `Jarvis on ${os.hostname()}` },
  });
  const paired = assertSuccess(pairedResponse);
  return upsertCompanionDevice({
    id: paired.deviceId,
    name: paired.deviceName,
    address,
    token: paired.token,
    fingerprint: pairedResponse.fingerprint,
    platform: paired.platform,
    arch: paired.arch,
    pairedAt: new Date().toISOString(),
  });
}

export async function companionStatus(device: CompanionDevice): Promise<CompanionStatus> {
  const response = await companionRequest<CompanionStatus & { error?: string }>(device.address, 'GET', '/v1/status', {
    token: device.token,
    fingerprint: device.fingerprint,
  });
  return assertSuccess(response);
}

export async function listCompanionsWithStatus(): Promise<CompanionPublicDevice[]> {
  const devices = readCompanionRegistry().devices;
  return await Promise.all(devices.map(async (device) => {
    const base = {
      id: device.id,
      name: device.name,
      address: device.address,
      platform: device.platform,
      arch: device.arch,
      pairedAt: device.pairedAt,
    };
    try {
      const status = await companionStatus(device);
      return {
        ...base,
        online: true,
        paused: status.paused,
        hostname: status.hostname,
        screen: status.screen,
        displays: status.displays,
      };
    } catch (error) {
      return { ...base, online: false, error: error instanceof Error ? error.message : String(error) };
    }
  }));
}

export async function runCompanionCommand(
  target: string,
  command: 'status' | 'launch' | 'input' | 'capture',
  payload: Record<string, unknown> = {}
): Promise<unknown> {
  const device = resolveCompanionDevice(target);
  if (!device) throw new Error(`Unknown or ambiguous companion computer "${target}".`);
  if (command === 'status') return companionStatus(device);

  const claimResponse = await companionRequest<{ leaseToken: string; error?: string }>(
    device.address,
    'POST',
    '/v1/control/claim',
    { token: device.token, fingerprint: device.fingerprint }
  );
  const claim = assertSuccess(claimResponse);
  try {
    const endpoint = command === 'launch' ? '/v1/apps/launch' : command === 'input' ? '/v1/input' : '/v1/capture';
    const response = await companionRequest<Record<string, unknown> & { error?: string }>(
      device.address,
      'POST',
      endpoint,
      {
        token: device.token,
        leaseToken: claim.leaseToken,
        fingerprint: device.fingerprint,
        body: payload,
      }
    );
    return assertSuccess(response);
  } finally {
    await companionRequest(device.address, 'POST', '/v1/control/release', {
      token: device.token,
      leaseToken: claim.leaseToken,
      fingerprint: device.fingerprint,
    }).catch(() => undefined);
  }
}

export async function unpairCompanionDevice(id: string): Promise<boolean> {
  const device = readCompanionRegistry().devices.find((candidate) => candidate.id === id);
  if (!device) return false;
  const response = await companionRequest<{ revoked: boolean; error?: string }>(
    device.address,
    'POST',
    '/v1/controllers/revoke-self',
    { token: device.token, fingerprint: device.fingerprint }
  );
  assertSuccess(response);
  return removeCompanionDevice(id);
}

export { removeCompanionDevice, resolveCompanionDevice };
