import { NextRequest, NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';
import { writeFileSync, unlinkSync } from 'fs';
import sharp from 'sharp';
import * as robot from '@jitsi/robotjs';
import {
  controlWindowsMedia,
  getWindowsNowPlaying,
  isWindowsMediaHost,
} from '@/backend/media/windowsMediaSession';
import { searchDuckDuckGoHtml } from '@/backend/search/ddg-html-search';

const execAsync = promisify(exec);

// Run a single-line osascript safely
async function osa(line: string): Promise<string> {
  const { stdout } = await execAsync(`osascript -e ${JSON.stringify(line)}`);
  return stdout.trim();
}

// Write script to a temp file and run it — avoids all shell escaping and heredoc issues
async function osaScript(script: string): Promise<string> {
  const tmp = `/tmp/jarvis_music_${Date.now()}.applescript`;
  writeFileSync(tmp, script, 'utf8');
  try {
    const { stdout } = await execAsync(`osascript ${tmp}`);
    return stdout.trim();
  } finally {
    try { unlinkSync(tmp); } catch { /* ignore cleanup errors */ }
  }
}

interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

async function getSpotifyWindowBounds(): Promise<WindowBounds> {
  const raw = await osaScript(`tell application "Spotify" to activate
delay 0.5
tell application "System Events"
  tell process "Spotify"
    set frontmost to true
    set {windowX, windowY} to position of front window
    set {windowWidth, windowHeight} to size of front window
    return (windowX as text) & "||" & (windowY as text) & "||" & (windowWidth as text) & "||" & (windowHeight as text)
  end tell
end tell`);
  const [x, y, width, height] = raw.split('||').map(Number);
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
    throw new Error('Could not determine the Spotify window position.');
  }
  return { x, y, width, height };
}

async function findSpotifyPlayButton(bounds: WindowBounds): Promise<{ x: number; y: number }> {
  const screenshotPath = `/tmp/jarvis_spotify_${Date.now()}.png`;
  try {
    await execAsync(
      `/usr/sbin/screencapture -x -R${bounds.x},${bounds.y},${bounds.width},${bounds.height} ${screenshotPath}`
    );

    const { data, info } = await sharp(screenshotPath)
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const regionLeft = Math.floor(info.width * 0.45);
    const regionRight = Math.floor(info.width * 0.98);
    const regionTop = Math.floor(info.height * 0.08);
    const regionBottom = Math.floor(info.height * 0.58);
    const regionWidth = regionRight - regionLeft;
    const regionHeight = regionBottom - regionTop;
    const mask = new Uint8Array(regionWidth * regionHeight);

    for (let localY = 0; localY < regionHeight; localY += 1) {
      const imageY = regionTop + localY;
      for (let localX = 0; localX < regionWidth; localX += 1) {
        const imageX = regionLeft + localX;
        const offset = (imageY * info.width + imageX) * info.channels;
        const red = data[offset];
        const green = data[offset + 1];
        const blue = data[offset + 2];
        if (green >= 145 && green - red >= 65 && green - blue >= 40) {
          mask[localY * regionWidth + localX] = 1;
        }
      }
    }

    const queue = new Int32Array(mask.length);
    let bestCount = 0;
    let bestSumX = 0;
    let bestSumY = 0;

    for (let start = 0; start < mask.length; start += 1) {
      if (mask[start] === 0) continue;

      let head = 0;
      let tail = 0;
      let count = 0;
      let sumX = 0;
      let sumY = 0;
      queue[tail++] = start;
      mask[start] = 0;

      while (head < tail) {
        const current = queue[head++];
        const localX = current % regionWidth;
        const localY = Math.floor(current / regionWidth);
        count += 1;
        sumX += regionLeft + localX;
        sumY += regionTop + localY;

        const neighbors = [
          localX > 0 ? current - 1 : -1,
          localX + 1 < regionWidth ? current + 1 : -1,
          localY > 0 ? current - regionWidth : -1,
          localY + 1 < regionHeight ? current + regionWidth : -1,
        ];
        for (const neighbor of neighbors) {
          if (neighbor >= 0 && mask[neighbor] === 1) {
            mask[neighbor] = 0;
            queue[tail++] = neighbor;
          }
        }
      }

      if (count > bestCount) {
        bestCount = count;
        bestSumX = sumX;
        bestSumY = sumY;
      }
    }

    const scaleX = info.width / bounds.width;
    const scaleY = info.height / bounds.height;
    if (bestCount < 300 * scaleX * scaleY) {
      throw new Error('Could not locate the Spotify Play button in the search results.');
    }

    return {
      x: Math.round(bounds.x + (bestSumX / bestCount) / scaleX),
      y: Math.round(bounds.y + (bestSumY / bestCount) / scaleY),
    };
  } finally {
    try { unlinkSync(screenshotPath); } catch { /* ignore cleanup errors */ }
  }
}

/**
 * Resolve a search query to a Spotify URI (spotify:track:… etc.) without any
 * UI scripting, via a keyless DuckDuckGo lookup of open.spotify.com pages.
 */
async function findSpotifyUri(query: string): Promise<string | null> {
  try {
    const results = await searchDuckDuckGoHtml(`site:open.spotify.com ${query}`, 8);
    // Prefer entity types that reliably autoplay via Apple Events.
    for (const type of ['track', 'album', 'playlist', 'artist'] as const) {
      for (const r of results) {
        const m = r.url.match(
          new RegExp(`open\\.spotify\\.com/(?:intl-[a-z-]+/)?${type}/([A-Za-z0-9]{22})`)
        );
        if (m) return `spotify:${type}:${m[1]}`;
      }
    }
  } catch (err) {
    console.warn('[music] Spotify URI lookup failed:', err);
  }
  return null;
}

function spotifyTrackMatchesQuery(
  track: { title: string; artist: string },
  query: string
): boolean {
  const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const normalizedQuery = normalize(query);
  const byIndex = normalizedQuery.lastIndexOf(' by ');
  if (byIndex === -1) return true;

  const requestedTitle = normalizedQuery.slice(0, byIndex).trim();
  const requestedArtist = normalizedQuery.slice(byIndex + 4).trim();
  return normalize(track.title).includes(requestedTitle) && normalize(track.artist).includes(requestedArtist);
}

type SupportedApp = 'Spotify' | 'Music';

const MUSIC_APPS: SupportedApp[] = ['Spotify', 'Music'];

function isSupportedApp(value: unknown): value is SupportedApp {
  return value === 'Spotify' || value === 'Music';
}

async function isRunning(app: string): Promise<boolean> {
  try {
    const result = await osa(`application "${app}" is running`);
    return result === 'true';
  } catch {
    return false;
  }
}

async function detectApp(): Promise<SupportedApp | null> {
  for (const app of MUSIC_APPS) {
    if (await isRunning(app)) return app;
  }
  return null;
}

async function getNowPlaying(app: SupportedApp) {
  if (app === 'Spotify') {
    const raw = await osaScript(`tell application "Spotify"
  if player state is playing or player state is paused then
    set trackTitle to name of current track
    set trackArtist to artist of current track
    set trackAlbum to album of current track
    set trackArtwork to artwork url of current track
    set trackPosition to player position
    set trackDuration to duration of current track
    if player state is playing then
      set trackState to "playing"
    else
      set trackState to "paused"
    end if
    return trackTitle & "||" & trackArtist & "||" & trackAlbum & "||" & trackArtwork & "||" & (round trackPosition) & "||" & (round (trackDuration / 1000)) & "||" & trackState
  else
    return "STOPPED"
  end if
end tell`);

    if (raw === 'STOPPED' || !raw) return null;

    const parts = raw.split('||');
    return {
      app: 'Spotify',
      title:      parts[0]?.trim() ?? '',
      artist:     parts[1]?.trim() ?? '',
      album:      parts[2]?.trim() ?? '',
      artworkUrl: parts[3]?.trim() ?? '',
      position:   parseInt(parts[4] ?? '0', 10),
      duration:   parseInt(parts[5] ?? '0', 10),
      isPlaying:  (parts[6] ?? '').includes('playing'),
    };
  }

  if (app === 'Music') {
    const raw = await osaScript(`tell application "Music"
  if player state is playing or player state is paused then
    set trackTitle to name of current track
    set trackArtist to artist of current track
    set trackAlbum to album of current track
    set trackPosition to player position
    set trackDuration to duration of current track
    if player state is playing then
      set trackState to "playing"
    else
      set trackState to "paused"
    end if
    return trackTitle & "||" & trackArtist & "||" & trackAlbum & "||" & (round trackPosition) & "||" & (round trackDuration) & "||" & trackState
  else
    return "STOPPED"
  end if
end tell`);

    if (raw === 'STOPPED' || !raw) return null;

    const parts = raw.split('||');
    return {
      app: 'Music',
      title:      parts[0]?.trim() ?? '',
      artist:     parts[1]?.trim() ?? '',
      album:      parts[2]?.trim() ?? '',
      artworkUrl: '',
      position:   parseInt(parts[3] ?? '0', 10),
      duration:   parseInt(parts[4] ?? '0', 10),
      isPlaying:  (parts[5] ?? '').includes('playing'),
    };
  }

  return null;
}

async function detectPlayingApp() {
  for (const app of MUSIC_APPS) {
    if (!(await isRunning(app))) continue;
    const track = await getNowPlaying(app);
    if (track?.isPlaying) return { app, track };
  }
  return null;
}

// Fallback: use nowplaying-cli if installed (brew install nowplaying-cli)
// This reads the macOS system Now Playing widget — works with any app
async function getNowPlayingFallback() {
  try {
    const paths = [
      '/opt/homebrew/bin/nowplaying-cli',
      '/usr/local/bin/nowplaying-cli',
    ];

    let bin = '';
    for (const p of paths) {
      try {
        await execAsync(`test -f ${p}`);
        bin = p;
        break;
      } catch { /* not found */ }
    }
    if (!bin) return null;

    const fields = ['title', 'artist', 'album', 'artworkURL', 'elapsedTime', 'duration', 'playbackRate'];
    const values = await Promise.all(
      fields.map(async (f) => {
        try {
          const { stdout } = await execAsync(`${bin} get ${f}`);
          return stdout.trim();
        } catch {
          return '';
        }
      })
    );

    const [title, artist, album, artworkUrl, elapsedStr, durationStr, rateStr] = values;
    if (!title) return null;

    return {
      app: 'System',
      title,
      artist,
      album,
      artworkUrl: artworkUrl || '',
      position: Math.round(parseFloat(elapsedStr || '0')),
      duration: Math.round(parseFloat(durationStr || '0')),
      isPlaying: parseFloat(rateStr || '0') > 0,
    };
  } catch {
    return null;
  }
}

export async function GET() {
  try {
    if (isWindowsMediaHost()) {
      const win = await getWindowsNowPlaying();
      if (win.ok) return NextResponse.json(win.track);
      return NextResponse.json({ error: win.error });
    }

    // macOS: Prefer the app that is actively playing, then any running app.
    const playing = await detectPlayingApp();
    if (playing) return NextResponse.json(playing.track);

    const app = await detectApp();
    if (app) {
      const track = await getNowPlaying(app);
      if (track) return NextResponse.json(track);
    }

    // Fallback to system Now Playing (any app — browser, etc.)
    const fallback = await getNowPlayingFallback();
    if (fallback) return NextResponse.json(fallback);

    return NextResponse.json({ error: 'Nothing is currently playing.' });
  } catch (err) {
    console.error('[music GET]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { command, value, query, app: requestedApp } = await req.json();

    if (command === 'search_play') {
      if (process.platform !== 'darwin') {
        return NextResponse.json(
          { error: 'Native Spotify search and play is currently available on macOS only.' },
          { status: 501 }
        );
      }

      const searchQuery = typeof query === 'string' ? query.trim().slice(0, 250) : '';
      if (!searchQuery) {
        return NextResponse.json({ error: 'Missing Spotify search query.' }, { status: 400 });
      }

      // Fast path — resolve to a Spotify URI and play it with pure Apple
      // Events: no Accessibility permission, no focus steal, no robot clicks.
      const uri = await findSpotifyUri(searchQuery);
      if (uri) {
        try {
          await osaScript(`tell application "Spotify" to play track "${uri}"`);
          await new Promise((resolve) => setTimeout(resolve, 1500));
          const track = await getNowPlaying('Spotify');
          if (track?.isPlaying && spotifyTrackMatchesQuery(track, searchQuery)) {
            return NextResponse.json({
              success: true,
              command,
              query: searchQuery,
              app: 'Spotify',
              track,
              method: 'uri',
            });
          }
          console.warn(
            `[music] URI fast path did not verify for "${searchQuery}" (uri: ${uri}) — falling back to UI scripting.`
          );
        } catch (err) {
          console.warn('[music] URI fast path failed, falling back to UI scripting:', err);
        }
      }

      const escapedQuery = JSON.stringify(searchQuery);
      await osaScript(`tell application "Spotify" to activate
delay 1
tell application "System Events"
  if UI elements enabled is false then error "Jarvis needs Accessibility permission to control Spotify."
  tell process "Spotify" to set frontmost to true
  keystroke "l" using command down
  delay 0.3
  keystroke ${escapedQuery}
  key code 36
  delay 2
end tell`);

      const bounds = await getSpotifyWindowBounds();
      const playButton = await findSpotifyPlayButton(bounds);
      const previousMousePosition = robot.getMousePos();
      robot.updateScreenMetrics();
      robot.moveMouse(playButton.x, playButton.y);
      await new Promise((resolve) => setTimeout(resolve, 600));
      robot.mouseClick('left');
      await new Promise((resolve) => setTimeout(resolve, 200));
      robot.moveMouse(previousMousePosition.x, previousMousePosition.y);
      await new Promise((resolve) => setTimeout(resolve, 1300));

      const track = await getNowPlaying('Spotify');
      if (!track?.isPlaying || !spotifyTrackMatchesQuery(track, searchQuery)) {
        const actualTrack = track ? ` Instead, Spotify reports "${track.title}" by ${track.artist}.` : '';
        return NextResponse.json(
          { error: `Spotify found results for "${searchQuery}" but did not start the requested track.${actualTrack}` },
          { status: 502 }
        );
      }

      return NextResponse.json({
        success: true,
        command,
        query: searchQuery,
        app: 'Spotify',
        track,
      });
    }

    if (isWindowsMediaHost()) {
      if (!command || typeof command !== 'string') {
        return NextResponse.json({ error: 'Missing command' }, { status: 400 });
      }
      const r = await controlWindowsMedia(command, value);
      if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
      return NextResponse.json({ success: true, command, app: 'Windows' });
    }

    if (command === 'duck') {
      const playing = await detectPlayingApp();
      if (!playing) {
        return NextResponse.json({ success: true, command, ducked: false });
      }

      const { app } = playing;
      const rawVolume = await osa(`tell application "${app}" to get sound volume`);
      const previousVolume = Math.max(0, Math.min(100, Number(rawVolume)));
      const duckVolume = Math.max(0, Math.min(100, Number(value ?? 18)));
      if (Number.isFinite(previousVolume) && previousVolume > duckVolume) {
        await osa(`tell application "${app}" to set sound volume to ${duckVolume}`);
      }
      return NextResponse.json({
        success: true,
        command,
        app,
        ducked: Number.isFinite(previousVolume) && previousVolume > duckVolume,
        previousVolume: Number.isFinite(previousVolume) ? previousVolume : null,
      });
    }

    let app: SupportedApp | null = null;
    if (requestedApp !== undefined) {
      if (!isSupportedApp(requestedApp)) {
        return NextResponse.json({ error: `Unsupported music app: ${String(requestedApp)}` }, { status: 400 });
      }
      if (!(await isRunning(requestedApp))) {
        return NextResponse.json({ error: `${requestedApp} is not running.` }, { status: 400 });
      }
      app = requestedApp;
    } else {
      app = await detectApp();
    }
    if (!app) return NextResponse.json({ error: 'No supported music app (Spotify/Music) is running for control.' });

    let script = '';
    switch (command) {
      case 'play':
        script = `tell application "${app}" to play`;
        break;
      case 'pause':
        script = `tell application "${app}" to pause`;
        break;
      case 'playpause':
        script = `tell application "${app}" to playpause`;
        break;
      case 'next':
        script = `tell application "${app}" to next track`;
        break;
      case 'previous':
        script = `tell application "${app}" to previous track`;
        break;
      case 'volume': {
        const vol = Math.max(0, Math.min(100, Number(value ?? 50)));
        script = `tell application "${app}" to set sound volume to ${vol}`;
        break;
      }
      case 'volume_up':
        script = `tell application "${app}" to set sound volume to (sound volume + 10)`;
        break;
      case 'volume_down':
        script = `tell application "${app}" to set sound volume to (sound volume - 10)`;
        break;
      default:
        return NextResponse.json({ error: `Unknown command: ${command}` }, { status: 400 });
    }

    await osa(script);
    return NextResponse.json({ success: true, command, app });
  } catch (err) {
    console.error('[music POST]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
