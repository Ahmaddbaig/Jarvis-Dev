import { NextRequest, NextResponse } from 'next/server';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

// Proxy to the Voicebox.app local server (sh.voicebox.app) so Jarvis can use
// its AI voices for speech output. The app picks a random localhost port each
// launch, so we discover it from the running voicebox-server process.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

let cachedBase: string | null = null;
let lastLaunchAttempt = 0;

async function findRunningServer(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('ps', ['-axo', 'command']);
    const match = stdout
      .split('\n')
      .map((line) => line.match(/voicebox-server .*--port (\d+)/))
      .find((m) => m !== null);
    if (match) {
      const base = `http://127.0.0.1:${match[1]}`;
      if (await healthy(base)) return base;
    }
  } catch {
    // ps failed — treat as offline
  }
  return null;
}

async function discoverBase(): Promise<string | null> {
  if (process.env.VOICEBOX_URL) return process.env.VOICEBOX_URL;
  if (cachedBase && (await healthy(cachedBase))) return cachedBase;
  cachedBase = null;

  cachedBase = await findRunningServer();
  if (cachedBase) return cachedBase;

  // Not running — auto-launch the app hidden in the background (macOS only),
  // at most once per 30s so a broken install doesn't get hammered.
  if (process.platform === 'darwin' && Date.now() - lastLaunchAttempt > 30_000) {
    lastLaunchAttempt = Date.now();
    try {
      await execFileAsync('open', ['-gj', '-a', 'Voicebox']);
    } catch {
      return null; // app not installed
    }
    // The server takes a few seconds to come up after app launch.
    const deadline = Date.now() + 25_000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 1000));
      cachedBase = await findRunningServer();
      if (cachedBase) return cachedBase;
    }
  }
  return null;
}

async function healthy(base: string): Promise<boolean> {
  try {
    const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * GET → Voicebox status, voice profiles, and kokoro preset voices.
 * GET ?generation=<id> → generation status {status, duration} for TTS pacing.
 */
export async function GET(req: NextRequest) {
  const base = await discoverBase();
  if (!base) {
    return NextResponse.json({
      online: false,
      profiles: [],
      presets: [],
      error: 'Voicebox is not running. Open the Voicebox app first.',
    });
  }

  const generationId = req.nextUrl.searchParams.get('generation');
  if (generationId) {
    try {
      const res = await fetch(`${base}/history/${encodeURIComponent(generationId)}`, {
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) return NextResponse.json({ error: `HTTP ${res.status}` }, { status: 502 });
      const data = (await res.json()) as { status?: string; duration?: number; error?: string | null };
      return NextResponse.json({
        status: data.status ?? 'unknown',
        duration: data.duration ?? 0,
        error: data.error ?? null,
      });
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
    }
  }

  try {
    const [profilesRes, presetsRes, modelsRes] = await Promise.all([
      fetch(`${base}/profiles`, { signal: AbortSignal.timeout(3000) }),
      fetch(`${base}/profiles/presets/kokoro`, { signal: AbortSignal.timeout(3000) }),
      fetch(`${base}/models/status`, { signal: AbortSignal.timeout(3000) }),
    ]);
    const profiles = profilesRes.ok
      ? ((await profilesRes.json()) as { id: string; name: string; preset_voice_id?: string | null }[])
      : [];
    const presetsData = presetsRes.ok
      ? ((await presetsRes.json()) as { voices?: { voice_id: string; name: string; gender: string; language: string }[] })
      : { voices: [] };
    const models = modelsRes.ok
      ? ((await modelsRes.json()) as { models?: { model_name: string; downloaded: boolean }[] })
      : { models: [] };

    return NextResponse.json({
      online: true,
      profiles: profiles.map((p) => ({ id: p.id, name: p.name, presetVoiceId: p.preset_voice_id ?? null })),
      presets: (presetsData.voices ?? []).filter((v) => v.language === 'en'),
      kokoroReady: (models.models ?? []).some((m) => m.model_name === 'kokoro' && m.downloaded),
    });
  } catch (e) {
    return NextResponse.json({
      online: false,
      profiles: [],
      presets: [],
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

/**
 * POST { text, profile?, engine? } → Voicebox /speak. Voicebox generates and
 * plays the audio itself through the system output.
 */
export async function POST(req: NextRequest) {
  let body: { text?: string; profile?: string; engine?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const text = (body.text ?? '').trim();
  if (!text) return NextResponse.json({ error: 'Missing "text"' }, { status: 400 });

  const base = await discoverBase();
  if (!base) {
    return NextResponse.json({ error: 'Voicebox is not running.' }, { status: 502 });
  }

  try {
    const res = await fetch(`${base}/speak`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: text.slice(0, 10_000),
        profile: body.profile || undefined,
        engine: body.engine || undefined,
        personality: false,
        language: 'en',
      }),
      // Generation + playback of a long reply can take a while.
      signal: AbortSignal.timeout(120_000),
    });
    const data = await res.text();
    if (!res.ok) {
      let message = data;
      try { message = (JSON.parse(data) as { detail?: string }).detail ?? data; } catch { /* raw */ }
      return NextResponse.json({ error: `Voicebox: ${message}` }, { status: 502 });
    }
    return new NextResponse(data, { headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
}
