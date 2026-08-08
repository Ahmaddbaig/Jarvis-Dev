import { z } from 'zod';
import { localAIProfileSchema } from './settings';

export const AI_ENGINE_PROTOCOL = 'jarvis.ai-engine/1' as const;
export type LocalAIProfileId = z.infer<typeof localAIProfileSchema>;

export const aiEngineJobStateSchema = z.enum([
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled',
]);

export const aiEngineJobSchema = z.object({
  id: z.string().regex(/^job_[a-f0-9]{32}$/),
  kind: z.enum(['warm', 'unload', 'validate']),
  profile: localAIProfileSchema.nullable(),
  state: aiEngineJobStateSchema,
  progress: z.number().min(0).max(1),
  message: z.string(),
  createdAt: z.string(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  result: z.record(z.string(), z.unknown()).nullable(),
  error: z.string().nullable(),
  cancellable: z.boolean(),
}).strict();
export type AIEngineJob = z.infer<typeof aiEngineJobSchema>;

export const aiEngineModelActionSchema = z.object({
  action: z.enum(['warm', 'unload', 'validate']),
  profile: localAIProfileSchema.optional(),
}).strict();
export type AIEngineModelAction = z.infer<typeof aiEngineModelActionSchema>;

export const localAIProfileDefinitionSchema = z.object({
  id: localAIProfileSchema,
  manifestId: z.string().min(1),
  label: z.string().min(1),
  hardware: z.string().min(1),
  minimumMemoryBytes: z.number().int().positive(),
  expectedMemoryBytes: z.number().int().positive(),
  expectedDiskBytes: z.number().int().positive(),
  capabilities: z.array(z.string()),
  idleUnloadSeconds: z.number().int().positive().nullable(),
  models: z.object({
    pipeline: z.string(),
    llm: z.string(),
    transcription: z.string(),
    vad: z.string(),
    tts: z.string(),
  }).strict(),
  installed: z.boolean(),
  warm: z.boolean(),
}).strict();

export const aiEngineModelsSchema = z.object({
  installedProfile: localAIProfileSchema.nullable(),
  warmProfile: localAIProfileSchema.nullable(),
  profiles: z.array(localAIProfileDefinitionSchema),
}).strict();
export type AIEngineModels = z.infer<typeof aiEngineModelsSchema>;

export const aiEngineSessionDescriptorSchema = z.object({
  schemaVersion: z.literal(1),
  protocol: z.literal(AI_ENGINE_PROTOCOL),
  host: z.literal('127.0.0.1'),
  port: z.number().int().min(1024).max(65_535),
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  pid: z.number().int().positive(),
  buildSha: z.string().min(1).max(128),
  startedAt: z.string(),
}).strict();
export type AIEngineSessionDescriptor = z.infer<typeof aiEngineSessionDescriptorSchema>;
