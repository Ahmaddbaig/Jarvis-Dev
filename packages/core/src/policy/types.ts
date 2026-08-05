import type {
  AuditEvent,
  CapabilityDefinition,
  CapabilityGrant,
  CommandEnvelope,
  JarvisError,
} from '@jarvis/contracts';

export type RequestSource = 'user' | 'model' | 'system' | 'remote-client';
export type { CapabilityDefinition };
export type { CapabilityGrant };

export interface PolicyContext {
  source: RequestSource;
  enabledAbilities: ReadonlySet<string>;
  approvalId?: string;
  userGesture?: boolean;
  visibleFeedback?: boolean;
  targetPaired?: boolean;
  activeLease?: boolean;
  emergencyStop?: boolean;
  untrustedInput?: boolean;
}

export interface PolicyDecision {
  allowed: boolean;
  definition?: CapabilityDefinition;
  error?: JarvisError;
}

export type AuditSink = (event: AuditEvent) => void;

export interface ApprovalIssueContext {
  source: RequestSource;
  userGesture: boolean;
  ttlMs?: number;
}

export interface GrantIssueContext {
  source: RequestSource;
  userGesture: boolean;
}

export interface ApprovalConsumption {
  ok: boolean;
  error?: JarvisError;
}

export interface Clock {
  now(): number;
}

export interface PolicyEvaluation {
  command: CommandEnvelope;
  context: PolicyContext;
}
