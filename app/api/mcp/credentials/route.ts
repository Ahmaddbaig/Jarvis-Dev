import { NextRequest, NextResponse } from 'next/server';
import { isAuthenticatedDesktopRequest } from '@/backend/desktop-auth';
import {
  deleteGoogleOAuthCredentials,
  googleOAuthClientInfo,
  saveGoogleOAuthCredentials,
} from '@/backend/secrets/google-credentials';

export async function GET() {
  try {
    const info = googleOAuthClientInfo();
    return NextResponse.json({
      exists: info !== null,
      isValid: info !== null,
      projectInfo: info ? { project_id: info.projectId, client_id: `${info.clientIdPrefix}...` } : null,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Google credential status is unavailable.' },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  if (!isAuthenticatedDesktopRequest(req)) {
    return NextResponse.json({ error: 'Google credential management is desktop-only.' }, { status: 401 });
  }
  try {
    const body = await req.json() as { content?: unknown };
    if (typeof body.content !== 'string') {
      return NextResponse.json({ error: 'Missing credentials content.' }, { status: 400 });
    }
    const info = saveGoogleOAuthCredentials(body.content);
    return NextResponse.json({ success: true, projectId: info.projectId });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Google credentials could not be saved.' },
      { status: 400 },
    );
  }
}

export async function DELETE(req: NextRequest) {
  if (!isAuthenticatedDesktopRequest(req)) {
    return NextResponse.json({ error: 'Google credential management is desktop-only.' }, { status: 401 });
  }
  try {
    deleteGoogleOAuthCredentials();
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Google credentials could not be removed.' },
      { status: 500 },
    );
  }
}
