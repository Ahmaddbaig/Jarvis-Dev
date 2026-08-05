import { z } from 'zod';
import { jarvisErrorSchema } from './errors';
import { idempotencyKeySchema, requestIdSchema, sessionIdSchema, traceIdSchema } from './identifiers';
import { jsonObjectSchema, jsonValueSchema } from './json-value';
import { JARVIS_PROTOCOL_VERSION } from './protocol';

export const actorSchema = z.object({
  type: z.enum(['desktop-user', 'lan-client', 'ai-engine', 'chrome-extension', 'companion', 'system']),
  id: z.string().min(1).max(128),
  deviceId: z.string().min(1).max(128).optional(),
}).strict();

const SECURITY_OWNED_ARGUMENTS = new Set([
  'approval',
  'approvalId',
  'capability',
  'confirmation',
  'confirmationId',
  'confirmed',
  'risk',
]);

export const operationSchema = z.object({
  kind: z.string().min(1).max(128).regex(/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/),
  version: z.number().int().min(1).max(65_535),
  args: jsonObjectSchema,
}).strict().superRefine((operation, context) => {
  for (const key of Object.keys(operation.args)) {
    if (SECURITY_OWNED_ARGUMENTS.has(key)) {
      context.addIssue({ code: 'custom', message: `${key} is owned by policy and cannot be supplied as an operation argument`, path: ['args', key] });
    }
  }
});

export const targetSchema = z.object({
  type: z.string().min(1).max(64).regex(/^[a-z][a-z0-9_-]*$/),
  id: z.string().min(1).max(256),
  fingerprint: z.string().min(8).max(512).optional(),
}).strict();

export const commandEnvelopeSchema = z.object({
  protocol: z.literal(JARVIS_PROTOCOL_VERSION),
  requestId: requestIdSchema,
  idempotencyKey: idempotencyKeySchema,
  actor: actorSchema,
  sessionId: sessionIdSchema,
  operation: operationSchema,
  target: targetSchema,
  deadline: z.iso.datetime({ offset: true }),
  traceId: traceIdSchema,
}).strict();

export type CommandEnvelope = z.infer<typeof commandEnvelopeSchema>;

const sideEffectSchema = z.object({
  attempted: z.boolean(),
  completed: z.boolean(),
  idempotentReplay: z.boolean(),
}).strict().refine((value) => !value.completed || value.attempted, {
  message: 'A completed side effect must have been attempted',
  path: ['completed'],
});

const timingSchema = z.object({
  queuedMs: z.number().finite().nonnegative(),
  executionMs: z.number().finite().nonnegative(),
  totalMs: z.number().finite().nonnegative(),
}).strict().refine((value) => value.totalMs >= value.queuedMs + value.executionMs, {
  message: 'totalMs must cover queuedMs plus executionMs',
  path: ['totalMs'],
});

export const commandResultSchema = z.object({
  requestId: requestIdSchema,
  ok: z.boolean(),
  status: z.string().min(1).max(96).regex(/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/),
  result: jsonValueSchema.optional(),
  error: jarvisErrorSchema.optional(),
  sideEffect: sideEffectSchema,
  timing: timingSchema,
  traceId: traceIdSchema,
}).strict().superRefine((value, context) => {
  if (value.ok && value.error) {
    context.addIssue({ code: 'custom', message: 'Successful results cannot include an error', path: ['error'] });
  }
  if (!value.ok && !value.error) {
    context.addIssue({ code: 'custom', message: 'Failed results must include an error', path: ['error'] });
  }
});

export type CommandResult = z.infer<typeof commandResultSchema>;
