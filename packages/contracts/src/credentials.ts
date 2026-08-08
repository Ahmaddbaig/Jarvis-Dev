import { z } from 'zod';

export const credentialKeySchema = z.enum([
  'openaiApiKey',
  'anthropicApiKey',
  'homeAssistantToken',
  'icalFeedUrl',
]);

export const credentialPatchSchema = z.object({
  openaiApiKey: z.string().min(1).max(8_192).optional(),
  anthropicApiKey: z.string().min(1).max(8_192).optional(),
  homeAssistantToken: z.string().min(1).max(8_192).optional(),
  icalFeedUrl: z.string().url().max(8_192).optional(),
}).strict();

export type CredentialKey = z.infer<typeof credentialKeySchema>;
export type CredentialPatch = z.infer<typeof credentialPatchSchema>;
export type CredentialStatus = Record<CredentialKey, boolean>;
