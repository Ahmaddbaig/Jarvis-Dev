import { z } from 'zod';
import { actorSchema, targetSchema } from './command';
import { opaqueIdSchema, requestIdSchema, traceIdSchema } from './identifiers';

export const RISK_CLASSES = [
  'read-public',
  'read-private',
  'local-reversible',
  'local-privileged',
  'external-side-effect',
  'remote-control',
  'credential-operation',
] as const;

export const riskClassSchema = z.enum(RISK_CLASSES);
export type RiskClass = z.infer<typeof riskClassSchema>;

export const capabilitySchema = z.string().min(3).max(128).regex(/^[a-z][a-z0-9]*(?:\.[a-z0-9_-]+)+$/);
export type Capability = z.infer<typeof capabilitySchema>;

export const confirmationModeSchema = z.enum(['never', 'always', 'when-model']);

export const capabilityDefinitionSchema = z.object({
  operation: z.string().min(1).max(128).regex(/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/),
  capability: capabilitySchema,
  risk: riskClassSchema,
  ability: z.string().min(1).max(128).regex(/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/),
  confirmation: confirmationModeSchema,
  targetFingerprintRequired: z.boolean().optional(),
}).strict();

export type CapabilityDefinition = z.infer<typeof capabilityDefinitionSchema>;

export const capabilityGrantInputSchema = z.object({
  actorId: z.string().min(1).max(128),
  capability: capabilitySchema,
  targetType: z.string().min(1).max(64).optional(),
  targetId: z.string().min(1).max(256).optional(),
  expiresAt: z.iso.datetime({ offset: true }).optional(),
}).strict().refine((grant) => !grant.targetId || Boolean(grant.targetType), {
  message: 'targetId requires targetType',
  path: ['targetType'],
});

export type CapabilityGrantInput = z.infer<typeof capabilityGrantInputSchema>;

export const capabilityGrantSchema = capabilityGrantInputSchema.safeExtend({
  grantId: opaqueIdSchema,
});

export type CapabilityGrant = z.infer<typeof capabilityGrantSchema>;

export const approvalReceiptSchema = z.object({
  approvalId: opaqueIdSchema,
  requestId: requestIdSchema,
  traceId: traceIdSchema,
  actor: actorSchema,
  capability: capabilitySchema,
  risk: riskClassSchema,
  target: targetSchema,
  bindingHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  issuedAt: z.iso.datetime({ offset: true }),
  expiresAt: z.iso.datetime({ offset: true }),
}).strict();

export type ApprovalReceipt = z.infer<typeof approvalReceiptSchema>;
