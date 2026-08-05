import { z } from 'zod';
import { actorSchema, targetSchema } from './command';
import { errorCodeSchema } from './errors';
import { opaqueIdSchema, requestIdSchema, traceIdSchema } from './identifiers';
import { jsonObjectSchema } from './json-value';
import { capabilitySchema, riskClassSchema } from './policy';

export const auditEventSchema = z.object({
  eventId: opaqueIdSchema,
  timestamp: z.iso.datetime({ offset: true }),
  traceId: traceIdSchema,
  requestId: requestIdSchema.optional(),
  actor: actorSchema,
  action: z.string().min(1).max(128),
  capability: capabilitySchema.optional(),
  risk: riskClassSchema.optional(),
  target: targetSchema.optional(),
  decision: z.enum(['allowed', 'denied', 'issued', 'consumed', 'expired', 'revoked', 'failed']),
  reasonCode: errorCodeSchema,
  metadata: jsonObjectSchema.default({}),
  redaction: z.object({
    applied: z.boolean(),
    fields: z.array(z.string().min(1).max(128)).max(100),
  }).strict(),
}).strict();

export type AuditEvent = z.infer<typeof auditEventSchema>;
