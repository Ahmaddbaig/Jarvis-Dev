import { z } from 'zod';

export const JARVIS_PROTOCOL_VERSION = 1 as const;

export const COMPONENT_KINDS = [
  'desktop',
  'core',
  'renderer',
  'ai-engine',
  'chrome-extension',
  'companion',
  'lan-client',
] as const;

export const protocolHandshakeSchema = z.object({
  protocol: z.literal(JARVIS_PROTOCOL_VERSION),
  component: z.enum(COMPONENT_KINDS),
  componentVersion: z.string().min(1).max(64),
  instanceId: z.string().min(8).max(128),
  features: z.array(z.string().min(1).max(96)).max(100).default([]),
}).strict();

export type ProtocolHandshake = z.infer<typeof protocolHandshakeSchema>;
