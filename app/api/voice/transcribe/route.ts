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
const MODEL_DIR = path.join(os.homedir(), '.cache', 'whisper-cpp');
// tiny.en first — ~3-4x faster than base.en on short voice commands with a
// small accuracy cost; base.en is the fallback when tiny isn't downloaded.
const MODEL_CANDIDATES = [
  path.join(MODEL_DIR, 'ggml-tiny.en.bin'),
  path.join(MODEL_DIR, 'ggml-base.en.bin'),
];
// Electron-launched servers often lack /opt/homebrew/bin in PATH.
const WHISPER_CANDIDATES = [
  '/opt/homebrew/bin/whisper-cli',
  '/usr/local/bin/whisper-cli',
  'whisper-cli',
];

function runWhisper(binary: string, modelPath: string, wavPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      binary,
      // -bs 1 (greedy, no beam search) and -nf (no temperature-fallback
      // retries) roughly halve decode time on short voice commands with
      // negligible accuracy cost.
      ['-m', modelPath, '-f', wavPath, '-nt', '-np', '-bs', '1', '-nf'],
      { timeout: TRANSCRIBE_TIMEOUT_MS },
      (err, stdout) => {
        if (err) reject(err);
        else resolve(stdout.trim());
      },
    );
  });
}

async function resolveModelPath(): Promise<string | null> {
  for (const candidate of MODEL_CANDIDATES) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // try the next size down the list
    }
  }
  return null;
}

async function transcribeFile(modelPath: string, wavPath: string): Promise<string> {
  let lastError: unknown = new Error('whisper-cli not found');
  for (const binary of WHISPER_CANDIDATES) {
    try {
      return await runWhisper(binary, modelPath, wavPath);
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

  const modelPath = await resolveModelPath();
  if (!modelPath) {
    return NextResponse.json(
      { error: `Whisper model missing — download it: curl -L -o ${MODEL_CANDIDATES[0]} https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin` },
      { status: 502 },
    );
  }

  const wavPath = path.join(os.tmpdir(), `jarvis-stt-${process.pid}-${Date.now()}.wav`);
  try {
    await fs.writeFile(wavPath, Buffer.from(await audio.arrayBuffer()));
    const text = await transcribeFile(modelPath, wavPath);
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
