import { randomId, sha256Hex } from './crypto';
import {
  approvalReceiptSchema,
  type ApprovalReceipt,
  type CommandEnvelope,
  type JarvisError,
  type JsonValue,
} from '@jarvis/contracts';
import type {
  ApprovalConsumption,
  ApprovalIssueContext,
  AuditSink,
  CapabilityDefinition,
  Clock,
} from './types';

const MAX_APPROVAL_TTL_MS = 2 * 60_000;
const systemClock: Clock = { now: () => Date.now() };

function canonicalJson(value: JsonValue): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

async function bindingHash(command: CommandEnvelope, definition: CapabilityDefinition): Promise<string> {
  const binding: JsonValue = {
    actor: command.actor,
    capability: definition.capability,
    operation: command.operation,
    risk: definition.risk,
    sessionId: command.sessionId,
    target: command.target,
  };
  return `sha256:${await sha256Hex(canonicalJson(binding))}`;
}

function policyError(code: string, message: string, traceId: string): JarvisError {
  return { family: 'POLICY', code, message, retryable: false, traceId };
}

export class ApprovalService {
  readonly #approvals = new Map<string, ApprovalReceipt>();
  readonly #clock: Clock;
  readonly #audit?: AuditSink;

  constructor(options: { clock?: Clock; audit?: AuditSink } = {}) {
    this.#clock = options.clock ?? systemClock;
    this.#audit = options.audit;
  }

  async issue(command: CommandEnvelope, definition: CapabilityDefinition, context: ApprovalIssueContext): Promise<ApprovalReceipt> {
    if (context.source !== 'user' || !context.userGesture) {
      throw new Error('Approvals can be issued only from an explicit user gesture.');
    }
    const issuedAtMs = this.#clock.now();
    const ttlMs = Math.min(Math.max(context.ttlMs ?? 60_000, 1), MAX_APPROVAL_TTL_MS);
    const receipt = approvalReceiptSchema.parse({
      approvalId: `approval:${randomId()}`,
      requestId: command.requestId,
      traceId: command.traceId,
      actor: command.actor,
      capability: definition.capability,
      risk: definition.risk,
      target: command.target,
      bindingHash: await bindingHash(command, definition),
      issuedAt: new Date(issuedAtMs).toISOString(),
      expiresAt: new Date(issuedAtMs + ttlMs).toISOString(),
    });
    this.#approvals.set(receipt.approvalId, receipt);
    this.#audit?.({
      eventId: `audit:${randomId()}`,
      timestamp: receipt.issuedAt,
      traceId: command.traceId,
      requestId: command.requestId,
      actor: command.actor,
      action: 'approval.issue',
      capability: definition.capability,
      risk: definition.risk,
      target: command.target,
      decision: 'issued',
      reasonCode: 'POLICY.APPROVAL_ISSUED',
      metadata: { expiresAt: receipt.expiresAt },
      redaction: { applied: false, fields: [] },
    });
    return receipt;
  }

  async consume(approvalId: string, command: CommandEnvelope, definition: CapabilityDefinition): Promise<ApprovalConsumption> {
    const receipt = this.#approvals.get(approvalId);
    if (receipt) this.#approvals.delete(approvalId);
    let error: JarvisError | undefined;
    if (!receipt) {
      error = policyError('POLICY.APPROVAL_INVALID', 'The approval is missing, unknown, or already consumed.', command.traceId);
    } else if (Date.parse(receipt.expiresAt) <= this.#clock.now()) {
      error = policyError('POLICY.APPROVAL_EXPIRED', 'The approval has expired.', command.traceId);
    } else if (receipt.requestId !== command.requestId || receipt.bindingHash !== await bindingHash(command, definition)) {
      error = policyError('POLICY.APPROVAL_BINDING_MISMATCH', 'The actor, operation, arguments, capability, risk, or target changed.', command.traceId);
    }
    this.#audit?.({
      eventId: `audit:${randomId()}`,
      timestamp: new Date(this.#clock.now()).toISOString(),
      traceId: command.traceId,
      requestId: command.requestId,
      actor: command.actor,
      action: 'approval.consume',
      capability: definition.capability,
      risk: definition.risk,
      target: command.target,
      decision: error ? (error.code.endsWith('EXPIRED') ? 'expired' : 'denied') : 'consumed',
      reasonCode: error?.code ?? 'POLICY.APPROVAL_CONSUMED',
      metadata: {},
      redaction: { applied: false, fields: [] },
    });
    return error ? { ok: false, error } : { ok: true };
  }
}
