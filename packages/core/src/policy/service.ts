import { randomId } from './crypto';
import type { JarvisError } from '@jarvis/contracts';
import { ApprovalService } from './approvals';
import { CapabilityCatalog } from './catalog';
import { CapabilityGrantStore } from './grants';
import type { AuditSink, CapabilityDefinition, PolicyContext, PolicyDecision, PolicyEvaluation } from './types';

function error(family: JarvisError['family'], code: string, message: string, traceId: string): JarvisError {
  return { family, code, message, retryable: false, traceId };
}

/**
 * Whether this command needs a one-time approval, without evaluating the rest
 * of policy.
 *
 * Callers use this to raise the confirmation prompt *before* dispatching, so a
 * command is evaluated once with its approval already in hand. Evaluating
 * twice would double-count the audit trail and consume the approval on the
 * first pass.
 */
export function confirmationRequiredFor(definition: CapabilityDefinition, context: PolicyContext): boolean {
  if (definition.confirmation === 'always') return true;
  return definition.confirmation === 'when-model'
    && (context.source === 'model' || Boolean(context.untrustedInput));
}

export class CapabilityPolicyService {
  readonly #catalog: CapabilityCatalog;
  readonly #grants: CapabilityGrantStore;
  readonly #approvals: ApprovalService;
  readonly #audit?: AuditSink;

  constructor(options: {
    catalog: CapabilityCatalog;
    grants: CapabilityGrantStore;
    approvals: ApprovalService;
    audit?: AuditSink;
  }) {
    this.#catalog = options.catalog;
    this.#grants = options.grants;
    this.#approvals = options.approvals;
    this.#audit = options.audit;
  }

  async evaluate({ command, context }: PolicyEvaluation): Promise<PolicyDecision> {
    const definition = this.#catalog.resolve(command.operation.kind);
    if (!definition) return this.#deny(command, context, undefined, error('VALIDATION', 'VALIDATION.UNKNOWN_OPERATION', 'The operation is not registered.', command.traceId));
    if (!context.enabledAbilities.has(definition.ability)) {
      return this.#deny(command, context, definition, error('POLICY', 'POLICY.ABILITY_DISABLED', 'The required ability is disabled.', command.traceId));
    }
    if (definition.targetFingerprintRequired && !command.target.fingerprint) {
      return this.#deny(command, context, definition, error('VALIDATION', 'VALIDATION.TARGET_FINGERPRINT_REQUIRED', 'The target requires a current fingerprint.', command.traceId));
    }

    const grantRequired = !['read-public', 'local-reversible'].includes(definition.risk);
    if (grantRequired && !this.#grants.allows(command, definition.capability)) {
      return this.#deny(command, context, definition, error('POLICY', 'POLICY.CAPABILITY_NOT_GRANTED', 'The actor does not have the required scoped capability.', command.traceId));
    }
    if (definition.risk === 'local-reversible' && !context.visibleFeedback) {
      return this.#deny(command, context, definition, error('POLICY', 'POLICY.VISIBLE_FEEDBACK_REQUIRED', 'This operation requires visible feedback.', command.traceId));
    }
    if (definition.risk === 'local-privileged' && command.actor.type !== 'desktop-user') {
      return this.#deny(command, context, definition, error('POLICY', 'POLICY.DESKTOP_ACTOR_REQUIRED', 'Privileged local operations require the desktop user.', command.traceId));
    }
    if (definition.risk === 'credential-operation' && (command.actor.type !== 'desktop-user' || context.source !== 'user' || !context.userGesture)) {
      return this.#deny(command, context, definition, error('POLICY', 'POLICY.USER_GESTURE_REQUIRED', 'Credential operations require an explicit desktop user gesture.', command.traceId));
    }
    if (definition.risk === 'remote-control') {
      if (context.emergencyStop) return this.#deny(command, context, definition, error('POLICY', 'POLICY.EMERGENCY_STOP_ACTIVE', 'Remote control is stopped.', command.traceId));
      if (!context.targetPaired) return this.#deny(command, context, definition, error('AUTH', 'AUTH.TARGET_NOT_PAIRED', 'The remote target is not paired.', command.traceId));
      if (!context.activeLease) return this.#deny(command, context, definition, error('CONFLICT', 'CONFLICT.CONTROL_LEASE_REQUIRED', 'An active control lease is required.', command.traceId));
    }

    if (confirmationRequiredFor(definition, context)) {
      if (!context.approvalId) {
        return this.#deny(command, context, definition, error('POLICY', 'POLICY.CONFIRMATION_REQUIRED', 'A target-bound one-time approval is required.', command.traceId));
      }
      const consumption = await this.#approvals.consume(context.approvalId, command, definition);
      if (!consumption.ok && consumption.error) return this.#deny(command, context, definition, consumption.error);
    }

    this.#record(command, definition, 'allowed', 'POLICY.ALLOWED', context);
    return { allowed: true, definition };
  }

  #deny(
    command: PolicyEvaluation['command'],
    context: PolicyContext,
    definition: CapabilityDefinition | undefined,
    reason: JarvisError,
  ): PolicyDecision {
    this.#record(command, definition, 'denied', reason.code, context);
    return { allowed: false, definition, error: reason };
  }

  #record(
    command: PolicyEvaluation['command'],
    definition: CapabilityDefinition | undefined,
    decision: 'allowed' | 'denied',
    reasonCode: string,
    context: PolicyContext,
  ): void {
    this.#audit?.({
      eventId: `audit:${randomId()}`,
      timestamp: new Date().toISOString(),
      traceId: command.traceId,
      requestId: command.requestId,
      actor: command.actor,
      action: 'policy.evaluate',
      capability: definition?.capability,
      risk: definition?.risk,
      target: command.target,
      decision,
      reasonCode,
      metadata: { source: context.source, untrustedInput: context.untrustedInput ?? false },
      redaction: { applied: false, fields: [] },
    });
  }
}
