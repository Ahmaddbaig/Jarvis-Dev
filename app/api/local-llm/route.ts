import { NextRequest, NextResponse } from 'next/server';

// Proxy to the local Ollama server so the renderer never deals with CORS and
// the Ollama URL stays configurable in one place.
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface OllamaTag {
  name: string;
  size?: number;
  details?: { parameter_size?: string; quantization_level?: string };
}

/** GET → Ollama status + installed models, so Settings can show live state. */
export async function GET() {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) {
      return NextResponse.json({ online: false, models: [], error: `Ollama responded ${res.status}` });
    }
    const data = (await res.json()) as { models?: OllamaTag[] };
    const models = (data.models ?? []).map((m) => ({
      name: m.name,
      size: m.size ?? 0,
      parameterSize: m.details?.parameter_size ?? '',
    }));
    return NextResponse.json({ online: true, models });
  } catch {
    return NextResponse.json({
      online: false,
      models: [],
      error: 'Ollama is not running. Install it (brew install ollama) and start it (brew services start ollama).',
    });
  }
}

/**
 * POST → chat completion via Ollama's native /api/chat.
 * Body: { model, messages, tools?, think? } — non-streaming; the voice
 * pipeline speaks whole sentences, so a single JSON response keeps the
 * tool-call loop simple.
 */
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const model = typeof body.model === 'string' ? body.model : '';
  if (!model) {
    return NextResponse.json({ error: 'Missing "model"' }, { status: 400 });
  }

  try {
    const res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: body.messages ?? [],
        tools: body.tools ?? undefined,
        // Voice latency matters more than deliberation; models that cannot
        // disable thinking simply ignore this flag.
        think: body.think ?? false,
        stream: false,
        // Keep the model resident between exchanges; a cold 17 GB load takes
        // ~17s, which is far too long mid-conversation.
        keep_alive: '30m',
        options: { temperature: 0.7 },
      }),
      // A cold model load on first request can take tens of seconds.
      signal: AbortSignal.timeout(180_000),
    });

    const text = await res.text();
    if (!res.ok) {
      let message = text;
      try { message = (JSON.parse(text) as { error?: string }).error ?? text; } catch { /* raw text */ }
      return NextResponse.json({ error: `Ollama: ${message}` }, { status: 502 });
    }
    return new NextResponse(text, { headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { error: `Could not reach Ollama at ${OLLAMA_URL}: ${message}` },
      { status: 502 },
    );
  }
}
