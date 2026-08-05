import { describe, expect, it } from 'vitest';
import {
  jarvisSettingsPatchSchema,
  jarvisSettingsSchema,
} from '../packages/contracts/src';

function validSettings() {
  return {
    schemaVersion: 1,
    apiMode: 'local',
    apiKey: '',
    localAIProfile: 'm5',
    localAIBaseUrl: 'http://127.0.0.1:8080',
    voice: 'echo',
    initialPrompt: 'Synthetic prompt',
    enabledFunctions: ['get_date', 'chrome_control'],
    theme: 'arc-reactor',
    grid: 'off',
    visualizer: 'frequency-ring',
    logo: 'logo',
    position: 'center',
  } as const;
}

describe('versioned Jarvis settings contract', () => {
  it('round-trips a valid current settings document', () => {
    expect(jarvisSettingsSchema.parse(validSettings())).toEqual(validSettings());
  });

  it('adds version 1 when importing an otherwise complete legacy document', () => {
    const legacy: Record<string, unknown> = { ...validSettings() };
    delete legacy.schemaVersion;
    expect(jarvisSettingsSchema.parse(legacy).schemaVersion).toBe(1);
  });

  it('validates strict bounded patches and rejects unknown fields', () => {
    expect(jarvisSettingsPatchSchema.parse({ theme: 'matrix' })).toEqual({ theme: 'matrix' });
    expect(jarvisSettingsPatchSchema.safeParse({ theme: 'unknown' }).success).toBe(false);
    expect(jarvisSettingsPatchSchema.safeParse({ confirmed: true }).success).toBe(false);
    expect(jarvisSettingsPatchSchema.safeParse({ initialPrompt: 'x'.repeat(32_769) }).success).toBe(false);
  });

  it('restricts LocalAI to loopback HTTP endpoints', () => {
    expect(jarvisSettingsSchema.safeParse({
      ...validSettings(),
      localAIBaseUrl: 'http://169.254.169.254/latest/meta-data',
    }).success).toBe(false);
    expect(jarvisSettingsSchema.safeParse({
      ...validSettings(),
      localAIBaseUrl: 'file:///tmp/model',
    }).success).toBe(false);
  });

  it('rejects duplicate or oversized enabled-function lists', () => {
    expect(jarvisSettingsSchema.safeParse({
      ...validSettings(),
      enabledFunctions: ['get_date', 'get_date'],
    }).success).toBe(false);
    expect(jarvisSettingsSchema.safeParse({
      ...validSettings(),
      enabledFunctions: Array.from({ length: 257 }, (_, index) => `tool_${index}`),
    }).success).toBe(false);
  });
});
