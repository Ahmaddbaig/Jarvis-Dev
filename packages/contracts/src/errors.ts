import { z } from 'zod';
import { jsonObjectSchema } from './json-value';
import { traceIdSchema } from './identifiers';

export const ERROR_FAMILIES = [
  'VALIDATION',
  'AUTH',
  'POLICY',
  'NOT_FOUND',
  'CONFLICT',
  'TRANSIENT',
  'EXECUTION',
  'INTERNAL',
] as const;

export const errorFamilySchema = z.enum(ERROR_FAMILIES);
export type ErrorFamily = z.infer<typeof errorFamilySchema>;

export const errorCodeSchema = z.string().min(3).max(96).regex(/^[A-Z][A-Z0-9_]*(?:\.[A-Z0-9_]+)*$/);

export const jarvisErrorSchema = z.object({
  family: errorFamilySchema,
  code: errorCodeSchema,
  message: z.string().min(1).max(1_024),
  retryable: z.boolean(),
  details: jsonObjectSchema.optional(),
  traceId: traceIdSchema.optional(),
}).strict().superRefine((error, context) => {
  if (error.retryable && error.family !== 'TRANSIENT') {
    context.addIssue({ code: 'custom', message: 'Only TRANSIENT errors are automatically retryable', path: ['retryable'] });
  }
});

export type JarvisError = z.infer<typeof jarvisErrorSchema>;

export const ERROR_HTTP_STATUS: Readonly<Record<ErrorFamily, number>> = Object.freeze({
  VALIDATION: 400,
  AUTH: 401,
  POLICY: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  TRANSIENT: 503,
  EXECUTION: 500,
  INTERNAL: 500,
});
