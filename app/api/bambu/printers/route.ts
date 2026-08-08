import { NextResponse } from 'next/server';
import { isTokenValid, getToken, getPrinters, fetchPrintersRest } from '@/backend/bambu/mqtt-manager';

export async function GET() {
  if (!isTokenValid()) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  // Return cached list first; if empty, re-fetch
  let printers = getPrinters();
  if (!printers.length) {
    const token = getToken()!;
    try {
      printers = await fetchPrintersRest(token);
    } catch (e) {
      return NextResponse.json({ error: String(e) }, { status: 500 });
    }
  }

  return NextResponse.json(printers);
}
