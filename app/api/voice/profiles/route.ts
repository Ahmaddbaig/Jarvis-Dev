import { NextResponse } from 'next/server';
import { listProfiles } from '@/backend/localvoice/voicebox';

/**
 * Voicebox status + voice profile list for the Settings UI.
 * GET → { ok, profiles: [{ id, name }], error? }
 */

export async function GET() {
  try {
    const profiles = await listProfiles();
    return NextResponse.json({
      ok: true,
      profiles: profiles.map((p) => ({ id: p.id, name: p.name })),
    });
  } catch {
    return NextResponse.json({
      ok: false,
      profiles: [],
      error: 'Voicebox is not reachable — install and open the Voicebox app.',
    });
  }
}
