import { z } from 'zod';

export const lanScopeSchema = z.enum(['read', 'control', 'ai', 'settings']);
export type LanScope = z.infer<typeof lanScopeSchema>;

export const lanScopesSchema = z.array(lanScopeSchema).min(1).max(4)
  .transform((scopes) => [...new Set(scopes)]);

export const createLanPairingSchema = z.object({
  scopes: lanScopesSchema.default(['read', 'control', 'ai', 'settings']),
}).strict();

export const exchangeLanPairingSchema = z.object({
  code: z.string().regex(/^\d{6}$/),
  clientName: z.string().trim().min(1).max(80),
  remoteAddress: z.string().trim().min(1).max(128),
  userAgent: z.string().max(1_024).default(''),
}).strict();

export const authorizeLanSessionSchema = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  method: z.string().trim().min(1).max(16).transform((value) => value.toUpperCase()),
  path: z.string().startsWith('/').max(2_048),
  requiredScope: lanScopeSchema.nullable(),
  consequential: z.boolean().default(false),
  remoteAddress: z.string().trim().min(1).max(128),
}).strict();

export interface LanClientView {
  readonly id: string;
  readonly name: string;
  readonly scopes: readonly LanScope[];
  readonly pairedAt: string;
  readonly lastSeenAt?: string;
  readonly revokedAt?: string;
}

export interface LanPairingCode {
  readonly code: string;
  readonly expiresAt: string;
  readonly scopes: readonly LanScope[];
}
