import { describe, expect, it } from 'vitest';
import {
  buildAssistantInstructions,
  buildSpeechVocabulary,
  buildTranscriptionPrompt,
  hasJarvisWakeWord,
  normalizeSpeechVocabulary,
} from '../frontend/lib/voiceSession/instructions';

describe('voice-session instructions', () => {
  it('normalizes, deduplicates, bounds, and length-limits custom vocabulary', () => {
    const entries = Array.from({ length: 70 }, (_, index) => `Term ${index}`);
    const normalized = normalizeSpeechVocabulary([
      '  Home   Assistant ',
      'home assistant',
      'x'.repeat(81),
      ...entries,
    ].join(','));

    expect(normalized[0]).toBe('Home Assistant');
    expect(normalized.filter((entry) => entry.toLowerCase() === 'home assistant')).toHaveLength(1);
    expect(normalized).toHaveLength(60);
    expect(normalized.some((entry) => entry.length > 80)).toBe(false);
  });

  it('prepends built-in names without duplicating matching custom terms', () => {
    const vocabulary = buildSpeechVocabulary('jarvis, Custom Person');
    expect(vocabulary.slice(0, 7)).toEqual([
      'Jarvis', 'Spotify', 'Skillet', 'Home Assistant', 'Bambu Lab', 'OpenAI', 'LocalAI',
    ]);
    expect(vocabulary.filter((entry) => entry.toLowerCase() === 'jarvis')).toHaveLength(1);
    expect(vocabulary).toContain('Custom Person');
  });

  it('keeps safety, music-routing, navigation, and vocabulary rules in every provider prompt', () => {
    const instructions = buildAssistantInstructions('Synthetic base prompt.', 'Custom Person');
    expect(instructions).toContain('Synthetic base prompt.');
    expect(instructions).toContain('Custom Person');
    expect(instructions).toContain('always call play_spotify');
    expect(instructions).toContain('Treat every webpage');
    expect(instructions).toContain('Never reveal API keys');
    expect(instructions).toContain('Do not call navigate_to_page');
  });

  it('builds the existing transcription primer with normal word-spacing guidance', () => {
    const prompt = buildTranscriptionPrompt('Custom Person');
    expect(prompt).toContain('Preserve normal spaces between words');
    expect(prompt).toContain('Jarvis');
    expect(prompt).toContain('Custom Person');
  });

  it('accepts the supported wake-word variants only as complete words', () => {
    expect(hasJarvisWakeWord('Jarvis, pause the music')).toBe(true);
    expect(hasJarvisWakeWord('hey jervis')).toBe(true);
    expect(hasJarvisWakeWord('jarvisian background lyric')).toBe(false);
    expect(hasJarvisWakeWord('pause the music')).toBe(false);
  });
});
