import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

// Local speech-to-text via whisper.cpp. A whisper-server child process is
// started on first use and kept warm so per-utterance latency stays low
// (the model loads once, not per request).
const WHISPER_PORT = Number(process.env.WHISPER_PORT || 8991);
const WHISPER_HOST = '127.0.0.1';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function findWhisperServer(): string | null {
  const candidates = [
    process.env.WHISPER_SERVER_PATH,
    '/opt/homebrew/bin/whisper-server',
    '/usr/local/bin/whisper-server',
  ].filter((p): p is string => !!p);
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}

function findWhisperModel(): string | null {
  const candidates = [
    process.env.WHISPER_MODEL_PATH,
    path.join(process.cwd(), 'models', 'whisper', 'ggml-small.en.bin'),
    path.join(process.cwd(), 'models', 'whisper', 'ggml-base.en.bin'),
  ].filter((p): p is string => !!p);
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}

async function serverIsUp(): Promise<boolean> {
  try {
    // whisper-server has no health route; any HTTP response means it's alive.
    const res = await fetch(`http://${WHISPER_HOST}:${WHISPER_PORT}/`, {
      signal: AbortSignal.timeout(750),
    });
    return res.status < 600;
  } catch {
    return false;
  }
}

let startingServer: Promise<void> | null = null;

async function ensureWhisperServer(): Promise<void> {
  if (await serverIsUp()) return;
  if (!startingServer) {
    startingServer = (async () => {
      const bin = findWhisperServer();
      if (!bin) {
        throw new Error(
          'whisper-server not found. Install it with: brew install whisper-cpp',
        );
      }
      const model = findWhisperModel();
      if (!model) {
        throw new Error(
          'Whisper model not found. Expected models/whisper/ggml-small.en.bin (download from https://huggingface.co/ggerganov/whisper.cpp).',
        );
      }
      const child = spawn(
        bin,
        ['-m', model, '--host', WHISPER_HOST, '--port', String(WHISPER_PORT), '--no-timestamps'],
        { stdio: 'ignore', detached: false },
      );
      child.on('error', () => { /* surfaced via timeout below */ });

      const deadline = Date.now() + 20_000;
      while (Date.now() < deadline) {
        if (await serverIsUp()) return;
        await new Promise((r) => setTimeout(r, 250));
      }
      throw new Error('whisper-server did not start within 20s');
    })().finally(() => {
      startingServer = null;
    });
  }
  return startingServer;
}

/** GET → readiness info for Settings/diagnostics. */
export async function GET() {
  const bin = findWhisperServer();
  const model = findWhisperModel();
  const up = await serverIsUp();
  return NextResponse.json({
    ready: !!bin && !!model,
    serverRunning: up,
    binary: bin,
    model,
  });
}

/** POST audio/wav (16-bit PCM mono 16kHz) → { text }. */
export async function POST(req: NextRequest) {
  try {
    const audio = Buffer.from(await req.arrayBuffer());
    if (audio.length < 1000) {
      return NextResponse.json({ text: '' });
    }

    await ensureWhisperServer();

    const form = new FormData();
    form.set('file', new Blob([new Uint8Array(audio)], { type: 'audio/wav' }), 'utterance.wav');
    form.set('temperature', '0.0');
    form.set('response_format', 'json');

    const res = await fetch(`http://${WHISPER_HOST}:${WHISPER_PORT}/inference`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json({ error: `whisper-server: ${text}` }, { status: 502 });
    }
    const data = (await res.json()) as { text?: string };
    return NextResponse.json({ text: (data.text ?? '').trim() });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
