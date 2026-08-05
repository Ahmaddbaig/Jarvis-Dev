import crypto from 'node:crypto';
import type {
  LanClientView,
  LanPairingCode,
  LanScope,
} from '@jarvis/contracts';
import type { PairingRecord } from '@jarvis/persistence';
import type { CoreStore } from '../persistence/core-store';
import { getCoreStore } from '../persistence/core-store';

const PAIRING_TTL_MS = 10 * 60_000;
const PAIRING_ATTEMPT_WINDOW_MS = 5 * 60_000;
const MAX_PAIRING_ATTEMPTS = 5;
const COMMAND_WINDOW_MS = 60_000;
const MAX_CONSEQUENTIAL_COMMANDS = 30;
const LAST_SEEN_WRITE_INTERVAL_MS = 5 * 60_000;
const PAIRING_PREFIX = 'lan-pairing:';
const DEVICE_PREFIX = 'lan-client:';

interface PendingPairing extends LanPairingCode {
  readonly expiresAtMs: number;
}

interface StoredMetadata extends Readonly<Record<string, unknown>> {
  readonly tokenHash: string;
  readonly scopes: readonly LanScope[];
  readonly userAgentHash: string;
  readonly lastSeenAt?: string;
}

export class LanGatewayAuthError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 401 | 403 | 404 | 409 | 429,
    readonly reason: string,
  ) {
    super(message);
    this.name = 'LanGatewayAuthError';
  }
}

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function timingSafeHexEqual(left: string, right: string): boolean {
  if (!/^[a-f0-9]{64}$/.test(left) || !/^[a-f0-9]{64}$/.test(right)) return false;
  return crypto.timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}

function pairingMetadata(pairing: PairingRecord): StoredMetadata | null {
  const tokenHash = pairing.metadata.tokenHash;
  const scopes = pairing.metadata.scopes;
  const userAgentHash = pairing.metadata.userAgentHash;
  const lastSeenAt = pairing.metadata.lastSeenAt;
  if (typeof tokenHash !== 'string' || !Array.isArray(scopes) || typeof userAgentHash !== 'string') return null;
  if (!scopes.every((scope) => ['read', 'control', 'ai', 'settings'].includes(String(scope)))) return null;
  return {
    tokenHash,
    scopes: scopes as LanScope[],
    userAgentHash,
    ...(typeof lastSeenAt === 'string' ? { lastSeenAt } : {}),
  };
}

export class LanSessionService {
  private pendingPairing: PendingPairing | null = null;
  private readonly attempts = new Map<string, number[]>();
  private readonly commands = new Map<string, number[]>();
  private readonly denialAudits = new Map<string, number[]>();

  constructor(private readonly store: CoreStore) {}

  createPairing(scopes: readonly LanScope[]): LanPairingCode {
    const code = crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
    const expiresAtMs = Date.now() + PAIRING_TTL_MS;
    this.pendingPairing = {
      code,
      expiresAt: new Date(expiresAtMs).toISOString(),
      expiresAtMs,
      scopes: [...new Set(scopes)],
    };
    this.audit({
      actorId: 'desktop-renderer',
      action: 'lan.pairing-code.create',
      resource: 'lan-gateway',
      decision: 'issued',
      reason: 'PAIRING_CODE_ISSUED',
      metadata: { scopes: this.pendingPairing.scopes, expiresAt: this.pendingPairing.expiresAt },
    });
    return this.publicPairing(this.pendingPairing);
  }

  currentPairing(): LanPairingCode | null {
    if (!this.pendingPairing || Date.now() >= this.pendingPairing.expiresAtMs) {
      this.pendingPairing = null;
      return null;
    }
    return this.publicPairing(this.pendingPairing);
  }

  listClients(): LanClientView[] {
    const devices = new Map(this.store.database.devices.list('lan-client').map((device) => [device.id, device]));
    return this.store.database.pairings.list()
      .filter((pairing) => pairing.id.startsWith(PAIRING_PREFIX))
      .flatMap((pairing): LanClientView[] => {
        const device = devices.get(pairing.deviceId);
        const metadata = pairingMetadata(pairing);
        if (!device || !metadata || !pairing.pairedAt) return [];
        return [{
          id: device.id,
          name: device.friendlyName,
          scopes: metadata.scopes,
          pairedAt: pairing.pairedAt,
          ...(metadata.lastSeenAt ? { lastSeenAt: metadata.lastSeenAt } : {}),
          ...(pairing.revokedAt ? { revokedAt: pairing.revokedAt } : {}),
        }];
      });
  }

  exchange(input: {
    code: string;
    clientName: string;
    remoteAddress: string;
    userAgent: string;
  }): { token: string; client: LanClientView } {
    const remoteHash = sha256(`lan-remote:${input.remoteAddress}`);
    if (!this.consume(this.attempts, remoteHash, MAX_PAIRING_ATTEMPTS, PAIRING_ATTEMPT_WINDOW_MS)) {
      this.auditDenied(null, 'lan.pair', 'lan-gateway', 'PAIRING_RATE_LIMITED', remoteHash);
      throw new LanGatewayAuthError('Too many pairing attempts. Wait five minutes.', 429, 'PAIRING_RATE_LIMITED');
    }
    const pending = this.currentPairing();
    if (!pending) {
      this.auditDenied(null, 'lan.pair', 'lan-gateway', 'PAIRING_CODE_MISSING', remoteHash);
      throw new LanGatewayAuthError('The pairing code expired. Generate a new code in Jarvis Settings.', 403, 'PAIRING_CODE_MISSING');
    }
    const suppliedHash = sha256(input.code);
    const expectedHash = sha256(pending.code);
    if (!timingSafeHexEqual(suppliedHash, expectedHash)) {
      this.auditDenied(null, 'lan.pair', 'lan-gateway', 'PAIRING_CODE_INVALID', remoteHash);
      throw new LanGatewayAuthError('The pairing code is incorrect.', 403, 'PAIRING_CODE_INVALID');
    }

    const uuid = crypto.randomUUID();
    const deviceId = `${DEVICE_PREFIX}${uuid}`;
    const pairingId = `${PAIRING_PREFIX}${uuid}`;
    const token = crypto.randomBytes(32).toString('base64url');
    const pairedAt = new Date().toISOString();
    const metadata: StoredMetadata = {
      tokenHash: sha256(token),
      scopes: pending.scopes,
      userAgentHash: sha256(input.userAgent),
      lastSeenAt: pairedAt,
    };
    const client: LanClientView = {
      id: deviceId,
      name: input.clientName,
      scopes: pending.scopes,
      pairedAt,
      lastSeenAt: pairedAt,
    };

    this.store.database.transaction(() => {
      this.store.database.devices.put({
        id: deviceId,
        kind: 'lan-client',
        friendlyName: input.clientName,
        platform: null,
        metadata: { userAgentHash: metadata.userAgentHash },
      });
      this.store.database.pairings.put({
        id: pairingId,
        deviceId,
        state: 'paired',
        pairedAt,
        metadata,
      });
      this.audit({
        actorId: deviceId,
        action: 'lan.pair',
        resource: 'lan-gateway',
        decision: 'allowed',
        reason: 'PAIRING_SUCCEEDED',
        remoteHash,
        metadata: { scopes: pending.scopes },
      });
    });
    this.pendingPairing = null;
    return { token, client };
  }

  authorize(input: {
    token: string;
    method: string;
    path: string;
    requiredScope: LanScope | null;
    consequential: boolean;
    remoteAddress: string;
  }): LanClientView {
    const remoteHash = sha256(`lan-remote:${input.remoteAddress}`);
    const suppliedHash = sha256(input.token);
    const pairing = this.store.database.pairings.list('paired')
      .filter((candidate) => candidate.id.startsWith(PAIRING_PREFIX))
      .find((candidate) => {
        const metadata = pairingMetadata(candidate);
        return metadata ? timingSafeHexEqual(metadata.tokenHash, suppliedHash) : false;
      });
    const metadata = pairing ? pairingMetadata(pairing) : null;
    const device = pairing ? this.store.database.devices.get(pairing.deviceId) : null;
    if (!pairing || !metadata || !device || !pairing.pairedAt) {
      this.auditDenied(null, 'lan.request', input.path, 'SESSION_INVALID', remoteHash);
      throw new LanGatewayAuthError('This LAN client is not paired with Jarvis.', 401, 'SESSION_INVALID');
    }
    if (input.requiredScope && !metadata.scopes.includes(input.requiredScope)) {
      this.auditDenied(device.id, 'lan.request', input.path, 'SCOPE_DENIED', remoteHash, {
        method: input.method,
        requiredScope: input.requiredScope,
      });
      throw new LanGatewayAuthError('This paired client does not have the required scope.', 403, 'SCOPE_DENIED');
    }
    if (input.consequential && !this.consume(
      this.commands,
      metadata.tokenHash,
      MAX_CONSEQUENTIAL_COMMANDS,
      COMMAND_WINDOW_MS,
    )) {
      this.auditDenied(device.id, 'lan.request', input.path, 'COMMAND_RATE_LIMITED', remoteHash, {
        method: input.method,
      });
      throw new LanGatewayAuthError('Too many consequential commands. Try again in one minute.', 429, 'COMMAND_RATE_LIMITED');
    }

    const now = new Date().toISOString();
    const lastSeenMs = metadata.lastSeenAt ? Date.parse(metadata.lastSeenAt) : 0;
    if (!Number.isFinite(lastSeenMs) || Date.now() - lastSeenMs >= LAST_SEEN_WRITE_INTERVAL_MS) {
      this.store.database.pairings.put({
        id: pairing.id,
        deviceId: pairing.deviceId,
        certificateFingerprint: pairing.certificateFingerprint,
        state: pairing.state,
        pairedAt: pairing.pairedAt,
        revokedAt: pairing.revokedAt,
        expiresAt: pairing.expiresAt,
        metadata: { ...metadata, lastSeenAt: now },
      });
    }
    if (input.consequential) {
      this.audit({
        actorId: device.id,
        action: 'lan.request',
        resource: input.path,
        decision: 'allowed',
        reason: 'SCOPED_REQUEST_ALLOWED',
        remoteHash,
        metadata: { method: input.method, requiredScope: input.requiredScope },
      });
    }
    return {
      id: device.id,
      name: device.friendlyName,
      scopes: metadata.scopes,
      pairedAt: pairing.pairedAt,
      lastSeenAt: now,
    };
  }

  revoke(deviceId: string): boolean {
    const pairing = this.store.database.pairings.list()
      .find((candidate) => candidate.id.startsWith(PAIRING_PREFIX) && candidate.deviceId === deviceId);
    if (!pairing || pairing.state === 'revoked') return false;
    const revokedAt = new Date().toISOString();
    this.store.database.transaction(() => {
      this.store.database.pairings.put({
        id: pairing.id,
        deviceId: pairing.deviceId,
        certificateFingerprint: pairing.certificateFingerprint,
        state: 'revoked',
        pairedAt: pairing.pairedAt,
        revokedAt,
        expiresAt: pairing.expiresAt,
        metadata: pairing.metadata,
      });
      this.audit({
        actorId: 'desktop-renderer',
        action: 'lan.client.revoke',
        resource: deviceId,
        decision: 'revoked',
        reason: 'CLIENT_REVOKED',
      });
    });
    return true;
  }

  private publicPairing(pairing: PendingPairing): LanPairingCode {
    return { code: pairing.code, expiresAt: pairing.expiresAt, scopes: pairing.scopes };
  }

  private consume(store: Map<string, number[]>, key: string, maximum: number, windowMs: number): boolean {
    const now = Date.now();
    for (const [candidate, timestamps] of store) {
      const recentTimestamps = timestamps.filter((timestamp) => now - timestamp < windowMs);
      if (recentTimestamps.length === 0) store.delete(candidate);
      else if (recentTimestamps.length !== timestamps.length) store.set(candidate, recentTimestamps);
    }
    const recent = (store.get(key) ?? []).filter((timestamp) => now - timestamp < windowMs);
    if (recent.length >= maximum) {
      store.set(key, recent);
      return false;
    }
    recent.push(now);
    store.set(key, recent);
    return true;
  }

  private auditDenied(
    actorId: string | null,
    action: string,
    resource: string,
    reason: string,
    remoteHash: string,
    metadata: Readonly<Record<string, unknown>> = {},
  ): void {
    const throttleKey = `${actorId ?? 'anonymous'}:${reason}:${resource}:${remoteHash}`;
    if (!this.consume(this.denialAudits, throttleKey, 1, 60_000)) return;
    this.audit({ actorId, action, resource, decision: 'denied', reason, remoteHash, metadata });
  }

  private audit(input: {
    actorId: string | null;
    action: string;
    resource: string;
    decision: 'allowed' | 'denied' | 'issued' | 'revoked' | 'failed';
    reason: string;
    remoteHash?: string;
    metadata?: Readonly<Record<string, unknown>>;
  }): void {
    this.store.database.securityAudit.append({
      id: `audit:${crypto.randomUUID()}`,
      ...input,
    });
  }
}

declare global {
  var __jarvisLanSessionService: LanSessionService | undefined;
}

export function getLanSessionService(): LanSessionService {
  if (!globalThis.__jarvisLanSessionService) {
    globalThis.__jarvisLanSessionService = new LanSessionService(getCoreStore());
  }
  return globalThis.__jarvisLanSessionService;
}
