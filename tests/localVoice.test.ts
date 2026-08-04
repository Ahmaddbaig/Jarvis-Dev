import { describe, expect, test } from 'vitest';
import {
  buildSystemPrompt,
  capHistory,
  parseToolArgs,
  toChatTools,
  ChatMessage,
} from '../frontend/lib/localVoice/chatTools';
import { encodeWav } from '../frontend/lib/localVoice/audio';

describe('toChatTools', () => {
  const tools = [
    { type: 'function' as const, name: 'a', description: 'tool a', parameters: { type: 'object' } },
    { type: 'function' as const, name: 'b', description: 'tool b', parameters: { type: 'object' } },
  ];

  test('maps realtime shape to nested chat-completions shape', () => {
    // Arrange + Act
    const result = toChatTools(tools, ['a', 'b']);

    // Assert
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      type: 'function',
      function: { name: 'a', description: 'tool a', parameters: { type: 'object' } },
    });
  });

  test('filters to enabled tool names only', () => {
    const result = toChatTools(tools, ['b']);
    expect(result.map((t) => t.function.name)).toEqual(['b']);
  });

  test('returns empty array when nothing is enabled', () => {
    expect(toChatTools(tools, [])).toEqual([]);
  });
});

describe('parseToolArgs', () => {
  test('passes objects through', () => {
    expect(parseToolArgs({ a: 1 })).toEqual({ a: 1 });
  });

  test('parses JSON strings', () => {
    expect(parseToolArgs('{"a":1}')).toEqual({ a: 1 });
  });

  test('returns empty object for invalid JSON', () => {
    expect(parseToolArgs('not json')).toEqual({});
  });
});

describe('buildSystemPrompt', () => {
  test('includes the configured initial prompt', () => {
    expect(buildSystemPrompt('You are Jarvis.')).toContain('You are Jarvis.');
  });

  test('includes spoken-style guidance', () => {
    expect(buildSystemPrompt('x')).toContain('text-to-speech');
  });
});

describe('capHistory', () => {
  const system: ChatMessage = { role: 'system', content: 'sys' };

  function turns(count: number): ChatMessage[] {
    return Array.from({ length: count }, (_, i) =>
      i % 2 === 0
        ? ({ role: 'user', content: `u${i}` } as ChatMessage)
        : ({ role: 'assistant', content: `a${i}` } as ChatMessage),
    );
  }

  test('returns history unchanged when under the cap', () => {
    const history = [system, ...turns(4)];
    expect(capHistory(history, 10)).toEqual(history);
  });

  test('keeps the system message and trims oldest turns', () => {
    const history = [system, ...turns(10)];
    const capped = capHistory(history, 4);
    expect(capped[0]).toEqual(system);
    expect(capped.length).toBeLessThanOrEqual(5);
    expect(capped[1].role).toBe('user');
  });

  test('never opens the window on a tool message', () => {
    const history: ChatMessage[] = [
      system,
      { role: 'user', content: 'u1' },
      { role: 'assistant', content: '', tool_calls: [{ id: 'c1', function: { name: 'f', arguments: '{}' } }] },
      { role: 'tool', tool_call_id: 'c1', content: '{}' },
      { role: 'assistant', content: 'a1' },
      { role: 'user', content: 'u2' },
      { role: 'assistant', content: 'a2' },
    ];
    const capped = capHistory(history, 4);
    expect(capped[0]).toEqual(system);
    expect(capped[1].role).toBe('user');
  });
});

describe('encodeWav', () => {
  test('produces a valid RIFF/WAVE header and correct size', async () => {
    const samples = new Float32Array(16000);
    const blob = encodeWav(samples, 16000);
    const bytes = new Uint8Array(await blob.arrayBuffer());

    const ascii = (start: number, len: number) =>
      String.fromCharCode(...bytes.slice(start, start + len));

    expect(ascii(0, 4)).toBe('RIFF');
    expect(ascii(8, 4)).toBe('WAVE');
    // 44-byte header + 2 bytes per 16-bit sample
    expect(bytes.length).toBe(44 + samples.length * 2);
  });
});
