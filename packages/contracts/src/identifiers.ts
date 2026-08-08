import { z } from 'zod';

const OPAQUE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;

export const opaqueIdSchema = z.string().min(8).max(128).regex(OPAQUE_ID_PATTERN);
export const requestIdSchema = opaqueIdSchema;
export const traceIdSchema = opaqueIdSchema;
export const idempotencyKeySchema = opaqueIdSchema;
export const sessionIdSchema = opaqueIdSchema;

function randomUuid(): string {
  const value = globalThis.crypto?.randomUUID?.();
  if (!value) throw new Error('A cryptographically secure randomUUID implementation is required.');
  return value;
}

export function createRequestId(): string {
  return `req:${randomUuid()}`;
}

export function createTraceId(): string {
  return `trace:${randomUuid()}`;
}

export function createIdempotencyKey(): string {
  return `idem:${randomUuid()}`;
}
