import { execFile } from 'child_process';
import { promisify } from 'util';
import { getVoiceboxUrl } from './config';

/**
 * Thin server-side client for the Voicebox REST API (local TTS/STT studio).
 * Only the endpoints Jarvis needs: profiles, generation queue, audio fetch.
 */

const execFileAsync = promisify(execFile);

const DEFAULT_PROFILE_NAME = 'Jarvis';
const DEFAULT_PRESET_ENGINE = 'kokoro';
const DEFAULT_PRESET_VOICE_ID = 'bm_george';
const GENERATION_POLL_INTERVAL_MS = 60;
// Generous: the first generation after idle cold-loads the TTS engine into
// MLX, which can take over a minute on a memory-pressured machine.
const GENERATION_TIMEOUT_MS = 120_000;
const REQUEST_TIMEOUT_MS = 15_000;
// Cold app launch plus server boot; measured at roughly 20s on an M5 Pro.
const LAUNCH_READY_TIMEOUT_MS = 30_000;
const LAUNCH_POLL_INTERVAL_MS = 500;
const LAUNCH_COOLDOWN_MS = 30_000;

export interface VoiceboxProfile {
  id: string;
  name: string;
  default_engine?: string | null;
  /** 'preset' (built-in voice) or 'cloned' (user's custom voice samples). */
  voice_type?: string | null;
  preset_engine?: string | null;
  preset_voice_id?: string | null;
}

interface GenerationResponse {
  id: string;
  status: string;
  error?: string | null;
}

function api(pathname: string): string {
  return `${getVoiceboxUrl()}${pathname}`;
}

let launchAttemptedAt = 0;

/**
 * Voicebox only serves its API while the app is running, so a user who has
 * simply quit it would otherwise get a failed reply rather than speech. Start
 * it in the background (no window, no focus steal) and wait for the server.
 *
 * macOS-only because the launch is `open`-based; other platforms fall through
 * to the original connection error. Rate-limited so a missing or broken
 * install is not relaunched on every request.
 */
async function tryStartVoicebox(): Promise<boolean> {
  if (process.platform !== 'darwin') return false;
  if (Date.now() - launchAttemptedAt < LAUNCH_COOLDOWN_MS) return false;
  launchAttemptedAt = Date.now();

  try {
    await execFileAsync('open', ['-gj', '-a', 'Voicebox']);
  } catch {
    return false; // Voicebox is not installed
  }

  const deadline = Date.now() + LAUNCH_READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, LAUNCH_POLL_INTERVAL_MS));
    try {
      const res = await fetch(api('/health'), { signal: AbortSignal.timeout(1_000) });
      if (res.ok) return true;
    } catch {
      // still booting
    }
  }
  return false;
}

export async function listProfiles(): Promise<VoiceboxProfile[]> {
  // Retry only on a connection-level failure, so the common (already running)
  // path costs nothing extra.
  let res: Response;
  try {
    res = await fetch(api('/profiles'), { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch (err) {
    if (!(await tryStartVoicebox())) throw err;
    res = await fetch(api('/profiles'), { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  }
  if (!res.ok) throw new Error(`Voicebox /profiles failed: ${res.status}`);
  const data = (await res.json()) as VoiceboxProfile[];
  return Array.isArray(data) ? data : [];
}

/**
 * Find the profile to speak with. If none is configured and no "Jarvis"
 * profile exists yet, create one from a Kokoro preset voice (British male)
 * so the local engine works with zero manual Voicebox setup.
 */
export async function resolveProfile(profileId?: string): Promise<VoiceboxProfile> {
  const profiles = await listProfiles();

  if (profileId) {
    const match = profiles.find((p) => p.id === profileId);
    if (match) return match;
  }

  const existing = profiles.find((p) => p.name === DEFAULT_PROFILE_NAME);
  if (existing) return existing;

  const res = await fetch(api('/profiles'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: DEFAULT_PROFILE_NAME,
      description: 'Auto-created by Jarvis local voice engine',
      language: 'en',
      voice_type: 'preset',
      preset_engine: DEFAULT_PRESET_ENGINE,
      preset_voice_id: DEFAULT_PRESET_VOICE_ID,
      default_engine: DEFAULT_PRESET_ENGINE,
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`Voicebox profile creation failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as VoiceboxProfile;
}

// Cold-loading a TTS engine into MLX takes ~40s for luxtts on this machine.
const MODEL_LOAD_TIMEOUT_MS = 150_000;

/**
 * Preload the TTS engine behind a profile so the first real sentence doesn't
 * pay the ~40s cold model load. No-op when the engine is already resident.
 */
export async function warmUpProfileEngine(
  profileId?: string,
): Promise<{ engine: string; wasLoaded: boolean }> {
  const profile = await resolveProfile(profileId);
  const engine = profile.default_engine ?? DEFAULT_PRESET_ENGINE;

  const statusRes = await fetch(api('/models/status'), {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!statusRes.ok) throw new Error(`Voicebox /models/status failed: ${statusRes.status}`);
  const { models } = (await statusRes.json()) as {
    models: { model_name: string; loaded: boolean }[];
  };
  const model = models.find((m) => m.model_name === engine);
  if (model?.loaded) return { engine, wasLoaded: true };

  // Blocks until the model is resident; that is the point.
  const loadRes = await fetch(api('/models/load'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model_name: engine }),
    signal: AbortSignal.timeout(MODEL_LOAD_TIMEOUT_MS),
  });
  if (!loadRes.ok) {
    throw new Error(`Voicebox /models/load failed: ${loadRes.status} ${await loadRes.text()}`);
  }
  return { engine, wasLoaded: false };
}

// Cloned-voice engines re-render timbre per generation; a pinned seed keeps
// the voice consistent across the chunks of one reply instead of drifting
// "robotic" between sentences.
const GENERATION_SEED = 1337;
// Style hint for engines that support instruct conditioning (ignored by the
// rest): counteracts the rushed, flat delivery of unconditioned generations.
// Engine-side chunking bounds: keep each internal generation short enough
// that delivery stays natural, with a small crossfade at the joins.
const MAX_ENGINE_CHUNK_CHARS = 140;
const CHUNK_CROSSFADE_MS = 40;
const DELIVERY_INSTRUCT =
  'Perform the line with warmth and character: a composed British butler with dry wit. Unhurried pace, expressive natural intonation, gentle emphasis on the important words, brief pauses at commas. Never monotone, never rushed.';

/** Submit a generation, wait for it to finish, and return the audio bytes. */
export async function generateSpeech(
  text: string,
  profile: VoiceboxProfile,
): Promise<{ audio: ArrayBuffer; contentType: string }> {
  const submitRes = await fetch(api('/generate'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      profile_id: profile.id,
      language: 'en',
      engine: profile.default_engine ?? DEFAULT_PRESET_ENGINE,
      seed: GENERATION_SEED,
      instruct: DELIVERY_INSTRUCT,
      // Let Voicebox split anything longer internally and crossfade the
      // joins — the engine's delivery degrades on long single inputs.
      max_chunk_chars: MAX_ENGINE_CHUNK_CHARS,
      crossfade_ms: CHUNK_CROSSFADE_MS,
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!submitRes.ok) {
    throw new Error(`Voicebox /generate failed: ${submitRes.status} ${await submitRes.text()}`);
  }
  const generation = (await submitRes.json()) as GenerationResponse;

  const deadline = Date.now() + GENERATION_TIMEOUT_MS;
  let status = generation.status;
  while (status !== 'completed') {
    if (status === 'failed' || status === 'cancelled') {
      throw new Error(`Voicebox generation ${status}`);
    }
    if (Date.now() > deadline) {
      throw new Error('Voicebox generation timed out');
    }
    await new Promise((resolve) => setTimeout(resolve, GENERATION_POLL_INTERVAL_MS));
    // NB: /generate/{id}/status is an SSE stream; /history/{id} returns the
    // same status as plain JSON, so poll that instead.
    const statusRes = await fetch(api(`/history/${generation.id}`), {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!statusRes.ok) throw new Error(`Voicebox status check failed: ${statusRes.status}`);
    status = ((await statusRes.json()) as GenerationResponse).status;
  }

  const audioRes = await fetch(api(`/audio/${generation.id}`), {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!audioRes.ok) throw new Error(`Voicebox audio fetch failed: ${audioRes.status}`);
  return {
    audio: await audioRes.arrayBuffer(),
    contentType: audioRes.headers.get('content-type') ?? 'audio/wav',
  };
}
