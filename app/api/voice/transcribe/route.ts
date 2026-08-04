import { NextRequest, NextResponse } from 'next/server';
import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

/**
 * Speech-to-text via whisper.cpp (spawned per request — no resident server
 * that can wedge; Metal-accelerated, ~0.5s warm for a short utterance).
 * POST multipart form: `audio` (16kHz mono wav) → { text }.
 *
 * Voicebox is deliberately NOT used for STT: it serializes all inference, so
 * transcription queued behind a cold TTS load left Jarvis deaf for minutes.
 */

const TRANSCRIBE_TIMEOUT_MS = 30_000;
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const MODEL_PATH = path.join(os.homedir(), '.cache', 'whisper-cpp', 'ggml-base.en.bin');
// Electron-launched servers often lack /opt/homebrew/bin in PATH.
const WHISPER_CANDIDATES = [
  '/opt/homebrew/bin/whisper-cli',
  '/usr/local/bin/whisper-cli',
  'whisper-cli',
];

function runWhisper(binary: string, wavPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      binary,
      ['-m', MODEL_PATH, '-f', wavPath, '-nt', '-np'],
      { timeout: TRANSCRIBE_TIMEOUT_MS },
      (err, stdout) => {
        if (err) reject(err);
        else resolve(stdout.trim());
      },
    );
  });
}

async function transcribeFile(wavPath: string): Promise<string> {
  let lastError: unknown = new Error('whisper-cli not found');
  for (const binary of WHISPER_CANDIDATES) {
    try {
      return await runWhisper(binary, wavPath);
    } catch (err) {
      lastError = err;
      const isMissingBinary = (err as NodeJS.ErrnoException)?.code === 'ENOENT';
      if (!isMissingBinary) break; // real failure — don't mask it by trying other paths
    }
  }
  throw lastError;
}

export async function POST(req: NextRequest) {
  let audio: File | null = null;
  try {
    const form = await req.formData();
    const entry = form.get('audio');
    audio = entry instanceof File ? entry : null;
  } catch {
    return NextResponse.json({ error: 'Expected multipart form data' }, { status: 400 });
  }

  if (!audio || audio.size === 0) {
    return NextResponse.json({ error: 'audio file is required' }, { status: 400 });
  }
  if (audio.size > MAX_AUDIO_BYTES) {
    return NextResponse.json({ error: 'audio file too large' }, { status: 413 });
  }

  try {
    await fs.access(MODEL_PATH);
  } catch {
    return NextResponse.json(
      { error: `Whisper model missing — download it: curl -L -o ${MODEL_PATH} https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin` },
      { status: 502 },
    );
  }

  const wavPath = path.join(os.tmpdir(), `jarvis-stt-${process.pid}-${Date.now()}.wav`);
  try {
    await fs.writeFile(wavPath, Buffer.from(await audio.arrayBuffer()));
    const text = await transcribeFile(wavPath);
    return NextResponse.json({ text, duration: null });
  } catch (err) {
    const isMissingBinary = (err as NodeJS.ErrnoException)?.code === 'ENOENT';
    console.error('[voice/transcribe]', err instanceof Error ? err.message : err);
    return NextResponse.json(
      {
        error: isMissingBinary
          ? 'whisper-cli not installed — run `brew install whisper-cpp`.'
          : 'Transcription failed.',
      },
      { status: 502 },
    );
  } finally {
    await fs.unlink(wavPath).catch(() => undefined);
  }
}
