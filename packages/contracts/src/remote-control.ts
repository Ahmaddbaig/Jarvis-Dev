import { z } from 'zod';
import { jsonObjectSchema, jsonValueSchema } from './json-value';

export const JARVIS_REMOTE_PROTOCOL_VERSION = 2 as const;
export const REMOTE_RESULT_RETENTION_MS = 5 * 60_000;

export const REMOTE_CAPABILITIES = {
  chrome: [
    'browser.tabs', 'browser.navigate', 'browser.page.read', 'browser.page.capture',
    'browser.page.click', 'browser.page.type', 'browser.page.scroll', 'result.replay',
  ],
  companion: [
    'device.status', 'screen.capture', 'screen.preview', 'input.constrained',
    'application.launch.allowlisted', 'control.lease', 'control.pause',
    'controller.revoke', 'result.replay',
  ],
} as const;

export const remoteComponentSchema = z.enum(['core', 'chrome-extension', 'companion']);
export const remoteCapabilitySchema = z.string().min(1).max(96).regex(/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/);

export const remoteHandshakeSchema = z.object({
  protocol: z.literal(JARVIS_REMOTE_PROTOCOL_VERSION),
  component: remoteComponentSchema,
  componentVersion: z.string().min(1).max(64),
  buildId: z.string().min(1).max(128),
  capabilities: z.array(remoteCapabilitySchema).min(1).max(100),
}).strict();
export type RemoteHandshake = z.infer<typeof remoteHandshakeSchema>;

export const remoteCommandSchema = z.object({
  protocol: z.literal(JARVIS_REMOTE_PROTOCOL_VERSION),
  commandId: z.uuid(),
  idempotencyKey: z.string().min(16).max(128).regex(/^[A-Za-z0-9:._-]+$/),
  capability: remoteCapabilitySchema,
  deadline: z.iso.datetime({ offset: true }),
  targetFingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  operation: z.string().min(1).max(96),
  args: jsonObjectSchema,
}).strict();
export type RemoteCommand = z.infer<typeof remoteCommandSchema>;

export const remoteResultSchema = z.object({
  protocol: z.literal(JARVIS_REMOTE_PROTOCOL_VERSION),
  commandId: z.uuid(),
  idempotencyKey: z.string().min(16).max(128),
  ok: z.boolean(),
  result: jsonValueSchema.optional(),
  error: z.string().min(1).max(2_000).optional(),
  completedAt: z.iso.datetime({ offset: true }),
  idempotentReplay: z.boolean().default(false),
}).strict().superRefine((result, context) => {
  if (result.ok && result.error) context.addIssue({ code: 'custom', path: ['error'], message: 'Successful results cannot include an error.' });
  if (!result.ok && !result.error) context.addIssue({ code: 'custom', path: ['error'], message: 'Failed results require an error.' });
});
export type RemoteResult = z.infer<typeof remoteResultSchema>;

export function remoteProtocolsCompatible(peerProtocol: unknown): peerProtocol is typeof JARVIS_REMOTE_PROTOCOL_VERSION {
  return peerProtocol === JARVIS_REMOTE_PROTOCOL_VERSION;
}

export function missingRemoteCapabilities(
  advertised: readonly string[],
  required: readonly string[],
): string[] {
  const available = new Set(advertised);
  return required.filter((capability) => !available.has(capability));
}
