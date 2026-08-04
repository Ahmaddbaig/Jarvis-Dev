/**
 * Pure helpers for the Voicebox voice engine's OpenAI chat brain.
 * Kept dependency-free so they are unit-testable in isolation.
 */

export interface ChatTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ChatToolCall {
  id?: string;
  type?: 'function';
  function: {
    name: string;
    arguments: Record<string, unknown> | string;
  };
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: ChatToolCall[];
  tool_call_id?: string;
}

/** Realtime-API tool shape used by JarvisFunction.tool */
export interface RealtimeToolShape {
  type: 'function';
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/** Convert Jarvis's OpenAI-Realtime tool definitions to the Chat Completions nested shape. */
export function toChatTools(
  tools: RealtimeToolShape[],
  enabledNames: string[],
): ChatTool[] {
  const enabled = new Set(enabledNames);
  return tools
    .filter((t) => enabled.has(t.name))
    .map((t) => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));
}

/** Parse tool-call arguments that may arrive as an object or a JSON string. */
export function parseToolArgs(args: Record<string, unknown> | string): Record<string, unknown> {
  if (typeof args !== 'string') return args ?? {};
  try {
    const parsed = JSON.parse(args) as unknown;
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** Build the system prompt for the Voicebox engine's spoken replies. */
export function buildSystemPrompt(initialPrompt: string): string {
  return (
    initialPrompt +
    '\n\nYour replies are spoken aloud by a text-to-speech engine: answer in 1-3 short sentences of plain prose. Never use markdown, lists, code blocks, or emoji.' +
    '\n\nDo not call navigate_to_page as part of a greeting or on your own initiative — only call it when the user explicitly asks to go to a different page.'
  );
}

// Below this length a "sentence" is more likely an abbreviation ("Dr.",
// "e.g.") than a real boundary — hold it until more text arrives.
const MIN_SPEAKABLE_CHARS = 12;
const SENTENCE_BOUNDARY = /[.!?…]+["')\]]?(?:\s+|$)/g;

/**
 * Pull complete, speakable sentences off the front of a streaming text
 * buffer. Returns the extracted chunks plus the unfinished remainder, so TTS
 * can start on sentence one while the model is still writing sentence three.
 */
export function extractSpeakableChunks(buffer: string): { chunks: string[]; rest: string } {
  const chunks: string[] = [];
  let start = 0;
  SENTENCE_BOUNDARY.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = SENTENCE_BOUNDARY.exec(buffer)) !== null) {
    const end = match.index + match[0].length;
    const candidate = buffer.slice(start, end).trim();
    if (candidate.length >= MIN_SPEAKABLE_CHARS) {
      chunks.push(candidate);
      start = end;
    }
    // Too short: leave `start` alone so the fragment merges into the next
    // sentence ("Dr." + " Smith is here.").
  }
  return { chunks, rest: buffer.slice(start) };
}

/**
 * Cap conversation history without corrupting tool-call chains.
 * Keeps the leading system message(s) plus the most recent messages, advancing
 * the cut to a user message so the window never opens mid tool exchange.
 */
export function capHistory(
  messages: ChatMessage[],
  maxNonSystem: number,
): ChatMessage[] {
  let systemEnd = 0;
  while (systemEnd < messages.length && messages[systemEnd].role === 'system') {
    systemEnd += 1;
  }
  const system = messages.slice(0, systemEnd);
  const rest = messages.slice(systemEnd);

  if (rest.length <= maxNonSystem) return messages;

  let start = rest.length - maxNonSystem;
  while (start < rest.length && rest[start].role !== 'user') {
    start += 1;
  }
  return [...system, ...rest.slice(start)];
}
