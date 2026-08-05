import { z } from 'zod';

export const JARVIS_SETTINGS_SCHEMA_VERSION = 1 as const;

export const voiceEngineModeSchema = z.enum(['openai', 'local', 'voicebox', 'elevenlabs']);
export const localAIProfileSchema = z.enum(['m2', 'm3', 'm5']);
export const jarvisThemeSchema = z.enum(['arc-reactor', 'midnight', 'crimson', 'matrix']);
export const jarvisGridSchema = z.enum(['off', 'small', 'medium', 'large']);
export const jarvisVisualizerSchema = z.enum([
  'frequency-ring',
  'arc-reactor',
  'sphere-nodes',
  'quarter-rings',
  'original',
]);
export const jarvisLogoSchema = z.enum(['logo', 'logo2']);
export const jarvisPositionSchema = z.enum([
  'center',
  'bottom-left',
  'bottom-right',
  'top-left',
  'top-right',
]);
export const realtimeModelSchema = z.enum([
  'gpt-realtime-2',
  'gpt-realtime-1.5',
  'gpt-realtime-mini',
]);
export const jarvisVoiceSchema = z.enum([
  'alloy', 'ash', 'ballad', 'coral', 'echo', 'sage', 'shimmer', 'verse', 'marin', 'cedar',
]);

const optionalBoundedString = (maximum: number) => z.string().max(maximum).optional();

export const localAIBaseUrlSchema = z.string().url().max(2_048).superRefine((value, context) => {
  const url = new URL(value);
  const hostname = url.hostname.toLowerCase();
  if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(hostname)) {
    context.addIssue({
      code: 'custom',
      message: 'LocalAI must use a loopback URL.',
    });
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    context.addIssue({ code: 'custom', message: 'LocalAI URL must use HTTP or HTTPS.' });
  }
});

const jarvisSettingsBaseSchema = z.object({
  schemaVersion: z.literal(JARVIS_SETTINGS_SCHEMA_VERSION).default(JARVIS_SETTINGS_SCHEMA_VERSION),
  apiMode: voiceEngineModeSchema,
  apiKey: z.string().max(8_192),
  realtimeModel: realtimeModelSchema.optional(),
  localAIProfile: localAIProfileSchema.optional(),
  localAIBaseUrl: localAIBaseUrlSchema.optional(),
  microphoneDeviceId: optionalBoundedString(512),
  speechVocabulary: optionalBoundedString(8_192),
  elevenLabsAgentId: optionalBoundedString(512),
  elevenLabsFirstMessage: optionalBoundedString(8_192),
  brainProvider: z.enum(['openai', 'claude']).optional(),
  chatModel: optionalBoundedString(256),
  claudeApiKey: optionalBoundedString(8_192),
  voiceboxProfileId: optionalBoundedString(512),
  voicePlaybackRate: z.number().finite().min(0.5).max(2).optional(),
  localFirstMessage: optionalBoundedString(8_192),
  voice: jarvisVoiceSchema,
  initialPrompt: z.string().max(32_768),
  enabledFunctions: z.array(z.string().min(1).max(128)).max(256),
  theme: jarvisThemeSchema,
  grid: jarvisGridSchema,
  visualizer: jarvisVisualizerSchema,
  logo: jarvisLogoSchema,
  position: jarvisPositionSchema,
  shellPathOverride: optionalBoundedString(4_096),
  pythonPathOverride: optionalBoundedString(4_096),
}).strict();

function requireUniqueFunctions(
  enabledFunctions: string[] | undefined,
  context: z.core.$RefinementCtx,
): void {
  if (enabledFunctions && new Set(enabledFunctions).size !== enabledFunctions.length) {
    context.addIssue({
      code: 'custom',
      message: 'Enabled function names must be unique.',
      path: ['enabledFunctions'],
    });
  }
}

export const jarvisSettingsSchema = jarvisSettingsBaseSchema.superRefine((settings, context) => {
  requireUniqueFunctions(settings.enabledFunctions, context);
});

export const jarvisSettingsPatchSchema = jarvisSettingsBaseSchema
  .omit({ schemaVersion: true })
  .partial()
  .extend({ schemaVersion: z.literal(JARVIS_SETTINGS_SCHEMA_VERSION).optional() })
  .strict()
  .superRefine((settings, context) => {
  requireUniqueFunctions(settings.enabledFunctions, context);
});

export type VoiceEngineMode = z.infer<typeof voiceEngineModeSchema>;
export type LocalAIProfile = z.infer<typeof localAIProfileSchema>;
export type JarvisTheme = z.infer<typeof jarvisThemeSchema>;
export type JarvisGrid = z.infer<typeof jarvisGridSchema>;
export type JarvisVisualizer = z.infer<typeof jarvisVisualizerSchema>;
export type JarvisLogo = z.infer<typeof jarvisLogoSchema>;
export type JarvisPosition = z.infer<typeof jarvisPositionSchema>;
export type RealtimeModel = z.infer<typeof realtimeModelSchema>;
export type JarvisSettings = z.infer<typeof jarvisSettingsSchema>;
