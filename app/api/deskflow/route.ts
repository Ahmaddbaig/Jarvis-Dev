import { NextRequest, NextResponse } from 'next/server';
import * as robot from '@jitsi/robotjs';
import { execFileSync } from 'child_process';
import {
  DeskflowEdge,
  DeskflowDirection,
  getDeskflowStatus,
  resolveDeskflowTarget,
  safeEdgeForTarget,
} from '@/backend/deskflow/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function sameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get('origin');
  const host = req.headers.get('host');
  if (!origin || !host) return false;
  try {
    const originUrl = new URL(origin);
    const isLoopback = ['127.0.0.1', 'localhost', '[::1]'].includes(originUrl.hostname);
    const fetchSite = req.headers.get('sec-fetch-site');
    return isLoopback && originUrl.host === host && (!fetchSite || fetchSite === 'same-origin');
  } catch {
    return false;
  }
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

interface DisplayRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function localDisplayRects(): DisplayRect[] {
  if (process.platform === 'darwin') {
    const script = [
      'ObjC.import("AppKit");',
      'const screens=$.NSScreen.screens.js;',
      'const mainHeight=Number(screens[0].frame.size.height);',
      'const result=screens.map((screen)=>{const frame=screen.frame; return {',
      'x:Number(frame.origin.x),',
      'y:mainHeight-Number(frame.origin.y)-Number(frame.size.height),',
      'width:Number(frame.size.width),',
      'height:Number(frame.size.height)};});',
      'JSON.stringify(result);',
    ].join('');
    const output = execFileSync('/usr/bin/osascript', ['-l', 'JavaScript', '-e', script], {
      encoding: 'utf8',
      timeout: 3000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return JSON.parse(output) as DisplayRect[];
  }

  if (process.platform === 'win32') {
    const script = [
      "$ErrorActionPreference='Stop'",
      'Add-Type -AssemblyName System.Windows.Forms',
      '$screens=@([System.Windows.Forms.Screen]::AllScreens | ForEach-Object {',
      '[pscustomobject]@{x=$_.Bounds.X;y=$_.Bounds.Y;width=$_.Bounds.Width;height=$_.Bounds.Height}})',
      '$screens | ConvertTo-Json -Compress',
    ].join(';');
    const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      encoding: 'utf8',
      timeout: 3000,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const parsed = JSON.parse(output) as DisplayRect | DisplayRect[];
    return Array.isArray(parsed) ? parsed : [parsed];
  }

  // RobotJS reports the X11 root-screen dimensions, which are already the
  // virtual desktop bounds when multiple monitors share an X screen.
  const size = robot.getScreenSize();
  return [{ x: 0, y: 0, width: size.width, height: size.height }];
}

function pointForDeskflowEdge(edge: DeskflowEdge): { edge: { x: number; y: number }; inside: { x: number; y: number } } {
  const displays = localDisplayRects().filter((display) =>
    [display.x, display.y, display.width, display.height].every(Number.isFinite) &&
    display.width > 0 && display.height > 0
  );
  if (displays.length === 0) throw new Error('Could not determine the local display layout.');

  const left = Math.min(...displays.map((display) => display.x));
  const top = Math.min(...displays.map((display) => display.y));
  const right = Math.max(...displays.map((display) => display.x + display.width));
  const bottom = Math.max(...displays.map((display) => display.y + display.height));
  const vertical = edge.direction === 'left' || edge.direction === 'right';
  const axisStart = vertical ? top : left;
  const axisLength = vertical ? bottom - top : right - left;
  const configuredStart = axisStart + axisLength * edge.start;
  const configuredEnd = axisStart + axisLength * edge.end;

  const boundaryDisplays = displays.filter((display) => {
    if (edge.direction === 'left') return display.x === left;
    if (edge.direction === 'right') return display.x + display.width === right;
    if (edge.direction === 'up') return display.y === top;
    return display.y + display.height === bottom;
  });
  const candidates = boundaryDisplays.map((display) => {
    const displayStart = vertical ? display.y : display.x;
    const displayEnd = displayStart + (vertical ? display.height : display.width);
    const start = Math.max(configuredStart, displayStart);
    const end = Math.min(configuredEnd, displayEnd);
    return { display, start, end, length: end - start };
  }).filter((candidate) => candidate.length > 1).sort((a, b) => b.length - a.length);

  const selected = candidates[0];
  if (!selected) {
    throw new Error(`Deskflow's configured ${edge.direction} edge range is not reachable on this display layout.`);
  }
  const along = Math.round((selected.start + selected.end) / 2);
  const inset = Math.max(1, Math.min(40, Math.floor(Math.min(selected.display.width, selected.display.height) / 4)));
  if (edge.direction === 'left') {
    return { edge: { x: left, y: along }, inside: { x: left + inset, y: along } };
  }
  if (edge.direction === 'right') {
    return { edge: { x: right - 1, y: along }, inside: { x: right - 1 - inset, y: along } };
  }
  if (edge.direction === 'up') {
    return { edge: { x: along, y: top }, inside: { x: along, y: top + inset } };
  }
  return { edge: { x: along, y: bottom - 1 }, inside: { x: along, y: bottom - 1 - inset } };
}

async function moveThroughEdge(
  edgeConfig: DeskflowEdge,
  switchDelayMs: number,
  switchDoubleTapMs: number
): Promise<void> {
  robot.updateScreenMetrics();
  const direction: DeskflowDirection = edgeConfig.direction;
  const { edge, inside } = pointForDeskflowEdge(edgeConfig);

  // An inside-to-edge motion works whether the target is local or remote. The
  // topology guard ensures the same edge is inert when control is already on
  // the requested computer, so repeated voice commands cannot overshoot.
  robot.moveMouse(inside.x, inside.y);
  await wait(60);
  const steps = 12;
  for (let step = 1; step <= steps; step += 1) {
    const x = Math.round(inside.x + ((edge.x - inside.x) * step) / steps);
    const y = Math.round(inside.y + ((edge.y - inside.y) * step) / steps);
    robot.moveMouse(x, y);
    await wait(12);
  }

  if (switchDoubleTapMs > 0) {
    await wait(Math.min(40, Math.max(10, Math.floor(switchDoubleTapMs / 4))));
    robot.moveMouse(inside.x, inside.y);
    await wait(Math.min(40, Math.max(10, Math.floor(switchDoubleTapMs / 4))));
    robot.moveMouse(edge.x, edge.y);
  }

  await wait(Math.max(120, switchDelayMs + 75));
}

export async function GET() {
  return NextResponse.json(getDeskflowStatus(), {
    headers: { 'Cache-Control': 'no-store' },
  });
}

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) {
    return NextResponse.json({ error: 'Deskflow control requires a same-origin Jarvis request.' }, { status: 403 });
  }

  try {
    const body = await req.json() as { action?: unknown; target?: unknown };
    if (body.action !== 'switch') {
      return NextResponse.json({ error: 'Unsupported Deskflow action.' }, { status: 400 });
    }
    const requestedTarget = typeof body.target === 'string' ? body.target : '';
    const status = getDeskflowStatus();
    if (!status.switchAvailable) {
      return NextResponse.json({ error: status.switchReason ?? 'Deskflow switching is unavailable.', status }, { status: 409 });
    }

    const target = resolveDeskflowTarget(status, requestedTarget);
    if (!target) {
      return NextResponse.json({
        error: `Unknown or ambiguous Deskflow computer "${requestedTarget}".`,
        availableComputers: status.screens,
      }, { status: 400 });
    }
    const edge = safeEdgeForTarget(status, target);
    if (!edge) {
      return NextResponse.json({
        error: `Deskflow's current layout cannot switch safely to "${target}" by edge. Configure a direct two-screen link or a Deskflow switchToScreen hotkey.`,
      }, { status: 409 });
    }

    await moveThroughEdge(
      edge,
      status.switchDelayMs,
      status.switchDoubleTapMs
    );
    return NextResponse.json({
      success: true,
      target,
      direction: edge.direction,
      message: `Deskflow control moved to ${target}.`,
      limitation: 'This switches keyboard and mouse only. Remote autonomous tasks require the Jarvis Windows companion.',
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
