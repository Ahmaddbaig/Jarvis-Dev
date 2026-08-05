import { describe, expect, test } from 'vitest';
import {
  hasUsableVoiceEngineConfig,
  migrateLegacyVoiceboxMode,
} from '../frontend/lib/voiceEngineMode';

describe('migrateLegacyVoiceboxMode', () => {
  test('moves old Voicebox settings off the LocalAI mode id', () => {
    const migrated = migrateLegacyVoiceboxMode({
      apiMode: 'local' as const,
      brainProvider: 'claude' as const,
      claudeApiKey: 'configured',
    });
    expect(migrated.apiMode).toBe('voicebox');
  });

  test('keeps an actual LocalAI profile in local mode', () => {
    const migrated = migrateLegacyVoiceboxMode({
      apiMode: 'local' as const,
      localAIProfile: 'm5',
    });
    expect(migrated.apiMode).toBe('local');
  });
});

describe('hasUsableVoiceEngineConfig', () => {
  test('allows LocalAI only on the machine where it is installed', () => {
    expect(hasUsableVoiceEngineConfig({ apiMode: 'local' }, true)).toBe(true);
    expect(hasUsableVoiceEngineConfig({ apiMode: 'local' }, false)).toBe(false);
  });

  test('checks the key belonging to the selected Voicebox brain', () => {
    expect(hasUsableVoiceEngineConfig({
      apiMode: 'voicebox',
      brainProvider: 'claude',
      claudeApiKey: 'configured',
    }, false)).toBe(true);
    expect(hasUsableVoiceEngineConfig({
      apiMode: 'voicebox',
      brainProvider: 'claude',
      apiKey: 'openai-only',
    }, false)).toBe(false);
    expect(hasUsableVoiceEngineConfig({
      apiMode: 'voicebox',
      brainProvider: 'openai',
      apiKey: 'configured',
      voiceboxProfileId: 'shared-jarvis-voice',
    }, false)).toBe(true);
    expect(hasUsableVoiceEngineConfig({
      apiMode: 'voicebox',
      brainProvider: 'openai',
      claudeApiKey: 'claude-only',
      voiceboxProfileId: 'shared-jarvis-voice',
    }, false)).toBe(false);
  });
});
