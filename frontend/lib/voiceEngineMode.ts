export type VoiceEngineMode = 'openai' | 'local' | 'voicebox' | 'elevenlabs';

export interface VoiceEngineConfig {
  apiMode?: VoiceEngineMode;
  apiKey?: string;
  localAIProfile?: string;
  elevenLabsAgentId?: string;
  brainProvider?: 'openai' | 'claude';
  claudeApiKey?: string;
  chatModel?: string;
  voiceboxProfileId?: string;
}

export interface VoiceCredentialStatus {
  openaiApiKey?: boolean;
  anthropicApiKey?: boolean;
}

/**
 * Voicebox originally used the mode id "local". LocalAI later claimed that
 * id, so recognize the old Voicebox-only fields before defaults are applied.
 */
export function migrateLegacyVoiceboxMode<T extends VoiceEngineConfig>(config: T): T {
  if (
    config.apiMode === 'local'
    && config.localAIProfile === undefined
    && Boolean(config.brainProvider || config.chatModel || config.claudeApiKey || config.voiceboxProfileId)
  ) {
    return { ...config, apiMode: 'voicebox' };
  }
  return config;
}

export function hasUsableVoiceEngineConfig(
  config: VoiceEngineConfig | null,
  allowLocalAI: boolean,
  // Required: defaulting to {} turns a forgotten argument into a silent
  // "voice never starts" with no diagnostic.
  credentialStatus: VoiceCredentialStatus,
): boolean {
  if (!config) return false;
  const mode = config.apiMode ?? 'openai';
  if (mode === 'local') return allowLocalAI;
  if (mode === 'elevenlabs') return Boolean(config.elevenLabsAgentId?.trim());
  if (mode === 'voicebox') {
    return config.brainProvider === 'claude'
      ? Boolean(credentialStatus.anthropicApiKey)
      : Boolean(credentialStatus.openaiApiKey);
  }
  return Boolean(credentialStatus.openaiApiKey);
}
