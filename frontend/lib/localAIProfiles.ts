export type LocalAIProfile = 'm2' | 'm3' | 'm5';

export interface LocalAIProfileDefinition {
  id: LocalAIProfile;
  label: string;
  hardware: string;
  description: string;
  llmModel: string;
  transcriptionModel: string;
  pipelineModel: string;
}

export const DEFAULT_LOCAL_AI_BASE_URL = 'http://127.0.0.1:8080';

export const LOCAL_AI_PROFILES: Record<LocalAIProfile, LocalAIProfileDefinition> = {
  m2: {
    id: 'm2',
    label: 'M2 Local',
    hardware: '8 GB RAM',
    description: 'Fastest, lightweight profile for the 8 GB M2 Mac.',
    llmModel: 'qwen_qwen3.5-2b',
    transcriptionModel: 'parakeet-cpp-realtime_eou_120m-v1',
    pipelineModel: 'jarvis-local-m2',
  },
  m3: {
    id: 'm3',
    label: 'M3 Local',
    hardware: '16 GB RAM',
    description: 'Balanced profile with higher-accuracy streaming speech recognition for the 16 GB M3 Mac.',
    llmModel: 'qwen_qwen3.5-4b',
    transcriptionModel: 'parakeet-cpp-nemotron-3.5-asr-streaming-0.6b',
    pipelineModel: 'jarvis-local-m3',
  },
  m5: {
    id: 'm5',
    label: 'M5 Local',
    hardware: '24 GB RAM',
    description: 'Higher-quality 9B profile with prompt-conditioned streaming speech recognition for this M5 Mac.',
    llmModel: 'qwen3.5-9b',
    transcriptionModel: 'parakeet-cpp-nemotron-3.5-asr-streaming-0.6b',
    pipelineModel: 'jarvis-local-m5',
  },
};

export function getLocalAIProfile(profile?: LocalAIProfile): LocalAIProfileDefinition {
  return LOCAL_AI_PROFILES[profile ?? 'm5'];
}

export function normalizeLocalAIBaseUrl(value?: string): string {
  const trimmed = value?.trim() || DEFAULT_LOCAL_AI_BASE_URL;
  return trimmed.replace(/\/+$/, '');
}
