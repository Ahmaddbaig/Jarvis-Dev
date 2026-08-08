import crypto from 'crypto';
import dns from 'dns/promises';
import net from 'net';
import os from 'os';
import tls from 'tls';
import {
  JARVIS_REMOTE_PROTOCOL_VERSION,
  REMOTE_CAPABILITIES,
  missingRemoteCapabilities,
} from '@jarvis/contracts';
import {
  readCompanionRegistry,
  removeCompanionDevice,
  resolveCompanionDevice,
  upsertCompanionDevice,
} from './registry';
import type {
  CompanionDevice,
  CompanionPreview,
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
  const unbracketed = hostname.replace(/^\[|\]$/g, '');
  const records = net.isIP(unbracketed)
    ? [{ address: unbracketed, family: net.isIPv4(unbracketed) ? 4 : 6 }]
    : await dns.lookup(unbracketed, { all: true, verbatim: true });
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
  options: {
    token?: string;
    leaseToken?: string;
    body?: unknown;
    fingerprint: string;
    idempotencyKey?: string;
    deadline?: string;
  }
): Promise<CompanionResponse<T>> {
  const normalized = normalizeCompanionAddress(address);
  const url = new URL(normalized);
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const resolvedAddress = await resolveLanHost(hostname);
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
      servername: net.isIP(hostname) ? undefined : hostname,
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
        ...(options.idempotencyKey ? [`X-Jarvis-Idempotency-Key: ${options.idempotencyKey}`] : []),
        ...(options.deadline ? [`X-Jarvis-Deadline: ${options.deadline}`] : []),
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

function assertCompanionCompatibility(value: {
  protocol?: unknown;
  componentVersion?: unknown;
  buildId?: unknown;
  capabilities?: unknown;
}): void {
  if (value.protocol !== JARVIS_REMOTE_PROTOCOL_VERSION) {
    throw new Error(`Companion protocol ${String(value.protocol)} is incompatible with Jarvis protocol ${JARVIS_REMOTE_PROTOCOL_VERSION}. Update the companion.`);
  }
  if (typeof value.componentVersion !== 'string' || typeof value.buildId !== 'string' || !Array.isArray(value.capabilities)) {
    throw new Error('Companion did not report a complete build and capability identity.');
  }
  const capabilities = value.capabilities.filter((item): item is string => typeof item === 'string');
  const missing = missingRemoteCapabilities(capabilities, REMOTE_CAPABILITIES.companion);
  if (missing.length > 0) throw new Error(`Companion is missing required capabilities: ${missing.join(', ')}.`);
}

async function companionIdempotentRequest<T extends { error?: string }>(
  device: CompanionDevice,
  pathname: string,
  body: unknown,
  idempotencyKey: string,
  leaseToken?: string,
): Promise<T> {
  const deadline = new Date(Date.now() + 30_000).toISOString();
  let response: CompanionResponse<T> | null = null;
  let firstError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      response = await companionRequest<T>(device.address, 'POST', pathname, {
        token: device.token,
        leaseToken,
        fingerprint: device.fingerprint,
        body,
        idempotencyKey,
        deadline,
      });
      break;
    } catch (error) {
      firstError ??= error;
    }
  }
  if (!response) throw firstError instanceof Error ? firstError : new Error('Companion command delivery failed.');
  const result = assertSuccess(response);
  await companionRequest(device.address, 'POST', '/v1/results/ack', {
    token: device.token,
    fingerprint: device.fingerprint,
    body: { idempotencyKeys: [idempotencyKey] },
  }).catch(() => undefined);
  return result;
}

export async function pairCompanion(input: {
  address: string;
  code: string;
  fingerprint: string;
}): Promise<CompanionDevice> {
  const address = normalizeCompanionAddress(input.address);
  const fingerprint = normalizeFingerprint(input.fingerprint);
  const identityResponse = await companionRequest<{
    protocol: number;
    componentVersion: string;
    buildId: string;
    capabilities: string[];
    deviceId: string;
    deviceName: string;
    platform: string;
    arch: string;
    fingerprint: string;
    error?: string;
  }>(address, 'GET', '/v1/identity', { fingerprint });
  const identity = assertSuccess(identityResponse);
  assertCompanionCompatibility(identity);
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
    protocol: number;
    componentVersion: string;
    buildId: string;
    capabilities: string[];
  }>(address, 'POST', '/v1/pair', {
    fingerprint: identityResponse.fingerprint,
    body: {
      code: input.code.trim(),
      controllerName: `Jarvis on ${os.hostname()}`,
      protocol: JARVIS_REMOTE_PROTOCOL_VERSION,
      controllerVersion: process.env.JARVIS_APP_VERSION || '1.1.0',
      capabilities: REMOTE_CAPABILITIES.companion,
    },
  });
  const paired = assertSuccess(pairedResponse);
  assertCompanionCompatibility(paired);
  return upsertCompanionDevice({
    id: paired.deviceId,
    name: paired.deviceName,
    address,
    token: paired.token,
    fingerprint: pairedResponse.fingerprint,
    platform: paired.platform,
    arch: paired.arch,
    pairedAt: new Date().toISOString(),
    protocol: paired.protocol,
    companionVersion: paired.componentVersion,
    buildId: paired.buildId,
    capabilities: paired.capabilities,
  });
}

export async function companionStatus(device: CompanionDevice): Promise<CompanionStatus> {
  const response = await companionRequest<CompanionStatus & { error?: string }>(device.address, 'GET', '/v1/status', {
    token: device.token,
    fingerprint: device.fingerprint,
  });
  const status = assertSuccess(response);
  assertCompanionCompatibility(status);
  return status;
}

export async function companionPreview(target: string, screen = 0): Promise<CompanionPreview> {
  const device = resolveCompanionDevice(target);
  if (!device) throw new Error(`Unknown or ambiguous companion computer "${target}".`);
  if (!Number.isInteger(screen) || screen < 0 || screen > 15) {
    throw new Error('Screen must be an integer from 0 to 15.');
  }
  const response = await companionRequest<CompanionPreview & { error?: string }>(
    device.address,
    'POST',
    '/v1/preview',
    {
      token: device.token,
      fingerprint: device.fingerprint,
      body: { screen },
    }
  );
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
      protocol: device.protocol,
      companionVersion: device.companionVersion,
      capabilities: device.capabilities,
      compatible: device.protocol === JARVIS_REMOTE_PROTOCOL_VERSION &&
        missingRemoteCapabilities(device.capabilities ?? [], REMOTE_CAPABILITIES.companion).length === 0,
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
        compatible: true,
        protocol: status.protocol,
        companionVersion: status.componentVersion,
        capabilities: status.capabilities,
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

  const commandId = crypto.randomUUID();
  const claim = await companionIdempotentRequest<{ leaseToken: string; error?: string }>(
    device,
    '/v1/control/claim',
    {},
    `companion:${commandId}:claim`,
  );
  try {
    const endpoint = command === 'launch' ? '/v1/apps/launch' : command === 'input' ? '/v1/input' : '/v1/capture';
    return await companionIdempotentRequest<Record<string, unknown> & { error?: string }>(
      device,
      endpoint,
      payload,
      `companion:${commandId}:execute`,
      claim.leaseToken,
    );
  } finally {
    await companionIdempotentRequest(
      device,
      '/v1/control/release',
      {},
      `companion:${commandId}:release`,
      claim.leaseToken,
    ).catch(() => undefined);
  }
}

export async function unpairCompanionDevice(id: string): Promise<boolean> {
  const device = readCompanionRegistry().devices.find((candidate) => candidate.id === id);
  if (!device) return false;
  try {
    const response = await companionRequest<{ revoked: boolean; error?: string }>(
      device.address,
      'POST',
      '/v1/controllers/revoke-self',
      { token: device.token, fingerprint: device.fingerprint }
    );
    assertSuccess(response);
  } catch (error) {
    // Forgetting a lost/offline computer must not be blocked by an unreachable
    // remote revocation endpoint. Its token is removed locally either way.
    console.warn('[companion] Remote revoke failed; removing local pairing:', error);
  }
  return removeCompanionDevice(id);
}

export { removeCompanionDevice, resolveCompanionDevice };
