import { NextRequest, NextResponse } from 'next/server';
import { getOpenAiApiKey } from '@/backend/localvoice/config';

/**
 * Brain for the Voicebox voice engine: one non-streaming OpenAI Chat
 * Completions round trip with optional tools. The client drives the
 * tool-call loop; the API key stays server-side.
 *
 * GET  — health for the Settings UI: is an API key configured?
 * POST — { model, messages, tools } → { message }
 */

const OPENAI_CHAT_URL = 'https://api.openai.com/v1/chat/completions';
const CHAT_TIMEOUT_MS = 60_000;
const MAX_MESSAGES = 128;
const MAX_TOTAL_CHARS = 200_000;

interface ChatMessage {
  role: string;
  content: string;
  tool_calls?: unknown[];
  tool_call_id?: string;
}

interface ChatRequestBody {
  model?: string;
  messages?: ChatMessage[];
  tools?: unknown[];
}

export async function GET() {
  const hasKey = getOpenAiApiKey().length > 0;
  return NextResponse.json({
    ok: hasKey,
    error: hasKey
      ? undefined
      : 'No OpenAI API key configured — add one in Settings (it is shared with the Realtime engine).',
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

  const apiKey = getOpenAiApiKey();
  if (!apiKey) {
    return NextResponse.json(
      { error: 'No OpenAI API key configured — add one in Settings.' },
      { status: 401 },
    );
  }

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
        stream: false,
      }),
      signal: AbortSignal.timeout(CHAT_TIMEOUT_MS),
    });

    if (!res.ok) {
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
      console.error('[voice/chat]', res.status, detail);
      return NextResponse.json(
        { error: detail ? `${friendly} ${detail}` : friendly },
        { status: 502 },
      );
    }

    const data = (await res.json()) as {
      choices?: { message?: ChatMessage }[];
    };
    const message = data.choices?.[0]?.message ?? { role: 'assistant', content: '' };
    return NextResponse.json({
      message: { ...message, content: message.content ?? '' },
    });
  } catch (err) {
    const isTimeout = err instanceof Error && err.name === 'TimeoutError';
    console.error('[voice/chat]', err instanceof Error ? err.message : err);
    return NextResponse.json(
      {
        error: isTimeout
          ? 'OpenAI request timed out.'
          : 'Could not reach the OpenAI API — check your internet connection.',
      },
      { status: 502 },
    );
  }
}
