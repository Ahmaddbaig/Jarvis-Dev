import { describe, expect, test } from 'vitest';
import {
  buildSystemPrompt,
  capHistory,
  extractSpeakableChunks,
  isNoiseTranscript,
  SentenceCoalescer,
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

describe('extractSpeakableChunks', () => {
  test('extracts complete sentences and keeps the unfinished tail', () => {
    const { chunks, rest } = extractSpeakableChunks(
      'Good evening, sir. All systems are online. The weather tod',
    );
    expect(chunks).toEqual(['Good evening, sir.', 'All systems are online.']);
    expect(rest).toBe('The weather tod');
  });

  test('returns no chunks for an incomplete sentence', () => {
    const { chunks, rest } = extractSpeakableChunks('Checking the printer status');
    expect(chunks).toEqual([]);
    expect(rest).toBe('Checking the printer status');
  });

  test('holds short abbreviation-like fragments until more text arrives', () => {
    const { chunks, rest } = extractSpeakableChunks('Dr. Smith has arrived at the lab. And');
    expect(chunks).toEqual(['Dr. Smith has arrived at the lab.']);
    expect(rest).toBe('And');
  });

  test('handles question and exclamation boundaries', () => {
    const { chunks } = extractSpeakableChunks('Shall I proceed, sir? Very well then!');
    expect(chunks).toEqual(['Shall I proceed, sir?', 'Very well then!']);
  });

  test('does not split decimal numbers', () => {
    const { chunks, rest } = extractSpeakableChunks('The value of pi is 3.14159 and counting');
    expect(chunks).toEqual([]);
    expect(rest).toBe('The value of pi is 3.14159 and counting');
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

describe('isNoiseTranscript', () => {
  test('flags classic whisper hallucinations on noise', () => {
    expect(isNoiseTranscript('you')).toBe(true);
    expect(isNoiseTranscript(' Thank you. ')).toBe(true);
    expect(isNoiseTranscript('Thanks for watching!')).toBe(true);
  });

  test('flags bracketed and parenthesized sound annotations', () => {
    expect(isNoiseTranscript('[BLANK_AUDIO]')).toBe(true);
    expect(isNoiseTranscript('(wind blowing)')).toBe(true);
    expect(isNoiseTranscript('*music*')).toBe(true);
  });

  test('keeps genuine short user turns', () => {
    expect(isNoiseTranscript('yes')).toBe(false);
    expect(isNoiseTranscript('no')).toBe(false);
    expect(isNoiseTranscript('stop')).toBe(false);
    expect(isNoiseTranscript('what time is it?')).toBe(false);
  });

  test('flags empty and punctuation-only transcripts', () => {
    expect(isNoiseTranscript('')).toBe(true);
    expect(isNoiseTranscript(' ... ')).toBe(true);
  });
});

describe('SentenceCoalescer', () => {
  test('flushes the first sentence immediately for fast time-to-voice', () => {
    // Arrange
    const coalescer = new SentenceCoalescer();

    // Act + Assert
    expect(coalescer.push('Good evening, sir.')).toBe('Good evening, sir.');
  });

  test('batches later sentences until they reach the minimum size', () => {
    // Arrange
    const coalescer = new SentenceCoalescer();
    coalescer.push('First sentence spoken right away.');
    const filler =
      'This deliberately verbose filler sentence keeps adding characters so the running batch crosses the coalescing threshold.';

    // Act
    const second = coalescer.push('A short one.');
    const third = coalescer.push(filler);

    // Assert
    expect(second).toBeNull();
    expect(third).toBe(`A short one. ${filler}`);
  });

  test('flush drains the batch and appends the unterminated tail', () => {
    // Arrange
    const coalescer = new SentenceCoalescer();
    coalescer.push('First.........');
    coalescer.push('Second sentence.');

    // Act
    const drained = coalescer.flush('and a trailing fragment');

    // Assert
    expect(drained).toBe('Second sentence. and a trailing fragment');
    expect(coalescer.flush()).toBeNull();
  });

  test('flush returns null when nothing is pending', () => {
    expect(new SentenceCoalescer().flush('')).toBeNull();
  });
});
