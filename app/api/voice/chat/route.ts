import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getClaudeApiKey, getOpenAiApiKey } from '@/backend/localvoice/config';

/**
 * Brain for the Voicebox voice engine: one chat round trip with optional
 * tools, against OpenAI or Claude depending on the selected provider.
 *
 * POST streams NDJSON so the client can start TTS on the first sentence
 * while the model is still writing:
 *   {"t":"d","text":"..."}  — incremental text delta
 *   {"t":"m","message":{...}} — final OpenAI-shaped message (incl. tool_calls)
 *   {"t":"e","error":"..."} — mid-stream failure
 * Pre-stream failures (bad key, validation) return plain JSON with an error
 * status. The client drives the tool-call loop in OpenAI chat-completions
 * shapes; the Claude branch converts formats server-side. Keys stay
 * server-side.
 *
 * GET ?provider=openai|claude — health for the Settings UI: key configured?
 */

const OPENAI_CHAT_URL = 'https://api.openai.com/v1/chat/completions';
const CHAT_TIMEOUT_MS = 60_000;
const MAX_MESSAGES = 128;
const MAX_TOTAL_CHARS = 200_000;
// Spoken replies are 1-3 sentences; tool calls are small. Claude output_config
// effort "low" keeps voice latency down (thinking stays on/adaptive — disabling
// it can make Claude emit tool calls as plain text).
const CLAUDE_MAX_TOKENS = 2048;
const CLAUDE_EFFORT = 'low';

type Provider = 'openai' | 'claude';

interface ChatToolCall {
  id?: string;
  type?: 'function';
  function: { name: string; arguments: Record<string, unknown> | string };
}

interface ChatMessage {
  role: string;
  content: string;
  tool_calls?: ChatToolCall[];
  tool_call_id?: string;
}

interface ChatTool {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

interface ChatRequestBody {
  provider?: string;
  model?: string;
  messages?: ChatMessage[];
  tools?: ChatTool[];
}

type Emit = (event: Record<string, unknown>) => void;

function keyForProvider(provider: Provider): string {
  return provider === 'claude' ? getClaudeApiKey() : getOpenAiApiKey();
}

export async function GET(req: NextRequest) {
  const provider: Provider =
    req.nextUrl.searchParams.get('provider') === 'claude' ? 'claude' : 'openai';
  const hasKey = keyForProvider(provider).length > 0;
  const label = provider === 'claude' ? 'Claude (Anthropic)' : 'OpenAI';
  return NextResponse.json({
    ok: hasKey,
    error: hasKey ? undefined : `No ${label} API key configured — add one in Settings.`,
  });
}

function validateChatBody(body: ChatRequestBody): string | null {
  if (!body.model || typeof body.model !== 'string') return 'model is required';
  if (!Array.isArray(body.messages) || body.messages.length === 0) return 'messages are required';
  if (body.messages.length > MAX_MESSAGES) return 'too many messages';
  const totalChars = body.messages.reduce(
    (sum, m) => sum + (typeof m.content === 'string' ? m.content.length : 0),
    0,
  );
  if (totalChars > MAX_TOTAL_CHARS) return 'conversation too large';
  return null;
}

/**
 * Convert OpenAI-style history to Anthropic Messages API params.
 *
 * Anthropic requires the first message to be role "user" and rejects empty
 * text blocks; consecutive same-role messages are merged into one so shapes
 * the frontend can legitimately produce (greeting-first sessions, a retried
 * user turn after a failed round trip, tool results split across messages)
 * never 400.
 */
function toClaudeRequest(messages: ChatMessage[], tools: ChatTool[]) {
  // Only LEADING system messages form the stable system prompt. Later ones
  // are mid-conversation contextual updates and must keep their position in
  // the transcript, not be presented as known-since-turn-one context.
  let leadEnd = 0;
  while (leadEnd < messages.length && messages[leadEnd].role === 'system') leadEnd += 1;
  const system = messages
    .slice(0, leadEnd)
    .map((m) => m.content)
    .join('\n\n');

  const claudeMessages: Anthropic.MessageParam[] = [];
  const push = (role: 'user' | 'assistant', blocks: Anthropic.ContentBlockParam[]) => {
    if (blocks.length === 0) return;
    const last = claudeMessages[claudeMessages.length - 1];
    if (last && last.role === role) {
      claudeMessages[claudeMessages.length - 1] = {
        ...last,
        content: [...(last.content as Anthropic.ContentBlockParam[]), ...blocks],
      };
    } else {
      claudeMessages.push({ role, content: blocks });
    }
  };

  for (const m of messages.slice(leadEnd)) {
    if (m.role === 'system') {
      // Mid-conversation contextual update — deliver in place as user context.
      if (m.content.trim()) {
        push('user', [{ type: 'text', text: `<context_update>${m.content}</context_update>` }]);
      }
      continue;
    }

    if (m.role === 'tool') {
      push('user', [
        {
          type: 'tool_result',
          tool_use_id: m.tool_call_id ?? '',
          content: m.content,
        },
      ]);
      continue;
    }

    if (m.role === 'assistant' && (m.tool_calls?.length ?? 0) > 0) {
      const blocks: Anthropic.ContentBlockParam[] = [];
      if (m.content.trim()) blocks.push({ type: 'text', text: m.content });
      for (const call of m.tool_calls ?? []) {
        const args = call.function.arguments;
        let input: Record<string, unknown> = {};
        if (typeof args === 'string') {
          try {
            input = JSON.parse(args) as Record<string, unknown>;
          } catch {
            input = {};
          }
        } else {
          input = args ?? {};
        }
        blocks.push({
          type: 'tool_use',
          id: call.id ?? `toolu_${blocks.length}`,
          name: call.function.name,
          input,
        });
      }
      push('assistant', blocks);
      continue;
    }

    if ((m.role === 'user' || m.role === 'assistant') && m.content.trim()) {
      push(m.role, [{ type: 'text', text: m.content }]);
    }
  }

  // A greeting-first session yields an assistant-led transcript, which
  // Anthropic rejects — anchor it with a neutral user turn.
  if (claudeMessages[0]?.role === 'assistant') {
    claudeMessages.unshift({
      role: 'user',
      content: [{ type: 'text', text: '(Session started.)' }],
    });
  }

  const claudeTools: Anthropic.Tool[] = tools.map((t) => ({
    name: t.function.name,
    description: t.function.description,
    input_schema: t.function.parameters as Anthropic.Tool.InputSchema,
  }));

  // Prompt-cache breakpoint on the newest history block: each round then
  // reads the whole prior conversation from cache instead of re-processing
  // ~24 tool schemas + system + history, which directly cuts time-to-first-
  // token on every turn after the first.
  const lastMessage = claudeMessages[claudeMessages.length - 1];
  if (lastMessage) {
    const blocks = lastMessage.content as Anthropic.ContentBlockParam[];
    const lastBlock = blocks[blocks.length - 1];
    if (lastBlock && (lastBlock.type === 'text' || lastBlock.type === 'tool_result')) {
      lastBlock.cache_control = { type: 'ephemeral' };
    }
  }

  return { system, claudeMessages, claudeTools };
}

/** Convert a Claude response back to the OpenAI-style message the client expects. */
function fromClaudeResponse(response: Anthropic.Message): ChatMessage {
  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
  const toolCalls: ChatToolCall[] = response.content
    .filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
    .map((b) => ({
      id: b.id,
      type: 'function' as const,
      function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) },
    }));

  return {
    role: 'assistant',
    content: text,
    ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
  };
}

function claudeErrorMessage(err: unknown, model: string): string {
  if (err instanceof Anthropic.AuthenticationError) {
    return 'Anthropic rejected the API key — check it in Settings.';
  }
  if (err instanceof Anthropic.NotFoundError) {
    return `Claude model "${model}" was not found — check the model name in Settings.`;
  }
  if (err instanceof Anthropic.RateLimitError) {
    return 'Anthropic rate limit hit — try again in a moment.';
  }
  if (err instanceof Anthropic.APIError) {
    return `Claude request failed (${err.status ?? 'network'}): ${err.message}`;
  }
  return 'Could not reach the Anthropic API — check your internet connection.';
}

async function streamClaude(
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  tools: ChatTool[],
  emit: Emit,
): Promise<void> {
  const client = new Anthropic({ apiKey, timeout: CHAT_TIMEOUT_MS });
  const { system, claudeMessages, claudeTools } = toClaudeRequest(messages, tools);

  try {
    const stream = client.messages.stream({
      model,
      max_tokens: CLAUDE_MAX_TOKENS,
      // effort errors on models without support (e.g. Haiku 4.5) — only send
      // it where it applies.
      ...(model.includes('haiku') ? {} : { output_config: { effort: CLAUDE_EFFORT } }),
      // Cache breakpoint on the system block also covers the tools (tools
      // render before system), so the fixed prefix is cached across turns.
      ...(system
        ? {
            system: [
              {
                type: 'text' as const,
                text: system,
                cache_control: { type: 'ephemeral' as const },
              },
            ],
          }
        : {}),
      ...(claudeTools.length > 0 ? { tools: claudeTools } : {}),
      messages: claudeMessages,
    });

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        emit({ t: 'd', text: event.delta.text });
      }
    }

    const response = await stream.finalMessage();
    if (response.stop_reason === 'refusal') {
      emit({
        t: 'm',
        message: {
          role: 'assistant',
          content: "I'm afraid I can't help with that request, sir.",
        },
      });
      return;
    }
    emit({ t: 'm', message: fromClaudeResponse(response) });
  } catch (err) {
    console.error('[voice/chat] claude', err instanceof Error ? err.message : err);
    emit({ t: 'e', error: claudeErrorMessage(err, model) });
  }
}

async function streamOpenAi(apiKey: string, body: ChatRequestBody, emit: Emit): Promise<void> {
  const tools = Array.isArray(body.tools) ? body.tools : [];
  try {
    const res = await fetch(OPENAI_CHAT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: body.model,
        messages: body.messages,
        ...(tools.length > 0 ? { tools } : {}),
        stream: true,
      }),
      signal: AbortSignal.timeout(CHAT_TIMEOUT_MS),
    });

    if (!res.ok || !res.body) {
      const text = await res.text();
      let detail = '';
      try {
        detail = (JSON.parse(text) as { error?: { message?: string } }).error?.message ?? '';
      } catch {
        detail = text.slice(0, 200);
      }
      const friendly =
        res.status === 401
          ? 'OpenAI rejected the API key — check it in Settings.'
          : res.status === 429
            ? 'OpenAI rate limit hit — try again in a moment.'
            : `OpenAI chat failed (${res.status})`;
      console.error('[voice/chat] openai', res.status, detail);
      emit({ t: 'e', error: detail ? `${friendly} ${detail}` : friendly });
      return;
    }

    // Parse the OpenAI SSE stream, forwarding text deltas and accumulating
    // the full message (content + indexed tool_call fragments).
    let content = '';
    const toolCalls = new Map<number, { id?: string; name: string; args: string }>();
    const decoder = new TextDecoder();
    const reader = res.body.getReader();
    let buffer = '';

    const handleLine = (line: string) => {
      if (!line.startsWith('data:')) return;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') return;
      let parsed: {
        choices?: {
          delta?: {
            content?: string | null;
            tool_calls?: {
              index: number;
              id?: string;
              function?: { name?: string; arguments?: string };
            }[];
          };
        }[];
      };
      try {
        parsed = JSON.parse(payload);
      } catch {
        return;
      }
      const delta = parsed.choices?.[0]?.delta;
      if (!delta) return;
      if (typeof delta.content === 'string' && delta.content) {
        content += delta.content;
        emit({ t: 'd', text: delta.content });
      }
      for (const tc of delta.tool_calls ?? []) {
        const entry = toolCalls.get(tc.index) ?? { name: '', args: '' };
        if (tc.id) entry.id = tc.id;
        if (tc.function?.name) entry.name += tc.function.name;
        if (tc.function?.arguments) entry.args += tc.function.arguments;
        toolCalls.set(tc.index, entry);
      }
    };

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) handleLine(line.trim());
    }
    if (buffer.trim()) handleLine(buffer.trim());

    const calls: ChatToolCall[] = [...toolCalls.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, c]) => ({
        id: c.id,
        type: 'function' as const,
        function: { name: c.name, arguments: c.args || '{}' },
      }));

    emit({
      t: 'm',
      message: {
        role: 'assistant',
        content,
        ...(calls.length > 0 ? { tool_calls: calls } : {}),
      },
    });
  } catch (err) {
    const isTimeout = err instanceof Error && err.name === 'TimeoutError';
    console.error('[voice/chat] openai', err instanceof Error ? err.message : err);
    emit({
      t: 'e',
      error: isTimeout
        ? 'OpenAI request timed out.'
        : 'Could not reach the OpenAI API — check your internet connection.',
    });
  }
}

export async function POST(req: NextRequest) {
  let body: ChatRequestBody;
  try {
    body = (await req.json()) as ChatRequestBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const validationError = validateChatBody(body);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  const provider: Provider = body.provider === 'claude' ? 'claude' : 'openai';
  const apiKey = keyForProvider(provider);
  if (!apiKey) {
    const label = provider === 'claude' ? 'Claude (Anthropic)' : 'OpenAI';
    return NextResponse.json(
      { error: `No ${label} API key configured — add one in Settings.` },
      { status: 401 },
    );
  }

  const encoder = new TextEncoder();
  const ndjson = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit: Emit = (event) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };
      try {
        if (provider === 'claude') {
          await streamClaude(apiKey, body.model!, body.messages!, body.tools ?? [], emit);
        } else {
          await streamOpenAi(apiKey, body, emit);
        }
      } catch (err) {
        console.error('[voice/chat]', err instanceof Error ? err.message : err);
        emit({ t: 'e', error: 'Chat request failed.' });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(ndjson, {
    headers: {
      'Content-Type': 'application/x-ndjson',
      'Cache-Control': 'no-store',
    },
  });
}
