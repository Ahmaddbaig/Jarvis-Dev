import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';

/**
 * Knowledge-galaxy dataset: scans every markdown note under the project root
 * and returns { nodes, links } for the GalaxyScreen main-screen view.
 *
 * TypeScript port of galaxy/build.py (the standalone viewer's generator) so
 * the in-app galaxy is always fresh — no build step, no extra server.
 *
 * Node ids equal their position in the nodes array; later features depend on
 * looking nodes up by index.
 */

const EXCERPT_CHARS = 700;
const MIN_TITLE_LEN = 4;
const MAX_FILE_BYTES = 2_000_000;
const CACHE_MS = 30_000;

const EXCLUDED_DIRS = new Set([
  '.git', 'node_modules', 'dist-electron', 'dist', 'out', 'build',
  'coverage', '.next', '__pycache__', '.venv', 'venv',
  'migration-backups', 'migration-quarantine',
]);

// Stems so generic that title-mention matching would wire everything to
// everything. They still get nodes and wikilink-based links.
const GENERIC_TITLES = new Set(['readme', 'index', 'notes', 'todo', 'changelog', 'license']);

const WIKILINK_RE = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g;

export interface GalaxyNode {
  id: number;
  label: string;
  group: string;
  path: string;
  excerpt: string;
}

export interface GalaxyLink {
  source: number;
  target: number;
  kind: 'wikilink' | 'mention';
  weight: number;
}

interface ScannedNote {
  label: string;
  group: string;
  path: string;
  excerpt: string;
  blob: string;
  wikilinks: Set<string>;
}

function norm(title: string): string {
  return title.replace(/\s+/g, ' ').trim().toLowerCase();
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function cleanText(raw: string): string {
  let text = raw.replace(/^---\s*\n[\s\S]*?\n---\s*\n/, '');       // frontmatter
  text = text.replace(/```[\s\S]*?```/g, ' ');                      // fenced code
  text = text.replace(/`([^`\n]*)`/g, '$1');
  text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ');                // images
  text = text.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');              // md links
  text = text.replace(WIKILINK_RE, '$1');                           // wikilinks
  text = text.replace(/^#{1,6}\s*/gm, '');                          // headings
  text = text.replace(/^[\s>*+-]{1,4}(?=\S)/gm, '');                // list/quote
  text = text.replace(/[*_]{1,3}(\S[^*_]*?)[*_]{1,3}/g, '$1');      // emphasis
  text = text.replace(/\|/g, ' ');                                  // tables
  return text.replace(/\s+/g, ' ').trim();
}

async function collectMarkdown(root: string): Promise<string[]> {
  const found: string[] = [];
  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || EXCLUDED_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
        found.push(full);
      }
    }
  }
  await walk(root);
  return found.sort();
}

async function buildGraph(root: string): Promise<{ nodes: GalaxyNode[]; links: GalaxyLink[] }> {
  const notes: ScannedNote[] = [];
  for (const file of await collectMarkdown(root)) {
    try {
      const stat = await fs.stat(file);
      if (stat.size > MAX_FILE_BYTES) continue;
      const raw = await fs.readFile(file, 'utf-8');
      const rel = path.relative(root, file);
      const cleaned = cleanText(raw);
      let excerpt = cleaned.slice(0, EXCERPT_CHARS);
      if (cleaned.length > EXCERPT_CHARS) {
        excerpt = excerpt.replace(/\s+\S*$/, '') + ' …';
      }
      const parent = path.dirname(rel);
      notes.push({
        label: path.basename(file, '.md'),
        group: parent === '.' ? path.basename(root) : path.basename(parent),
        path: rel,
        excerpt,
        blob: raw.toLowerCase(),
        wikilinks: new Set(
          [...raw.matchAll(WIKILINK_RE)].map((m) => norm(m[1])),
        ),
      });
    } catch {
      // unreadable file — skip
    }
  }

  // Disambiguate duplicate labels ("README" x N) for display only.
  const labelCounts = new Map<string, number>();
  for (const note of notes) {
    labelCounts.set(note.label, (labelCounts.get(note.label) ?? 0) + 1);
  }
  for (const note of notes) {
    if ((labelCounts.get(note.label) ?? 0) > 1) {
      note.label = `${note.label} (${note.group})`;
    }
  }

  const patterns = notes.map((note) => {
    const title = norm(note.label.replace(/\s*\([^)]*\)$/, ''));
    if (title.length < MIN_TITLE_LEN || GENERIC_TITLES.has(title)) return null;
    return new RegExp(`(?<![a-z0-9])${escapeRegExp(title)}(?![a-z0-9])`);
  });

  const links: GalaxyLink[] = [];
  for (let i = 0; i < notes.length; i++) {
    for (let j = i + 1; j < notes.length; j++) {
      const shared = [...notes[i].wikilinks].filter((w) => notes[j].wikilinks.has(w));
      const mentions =
        (patterns[j]?.test(notes[i].blob) ?? false) ||
        (patterns[i]?.test(notes[j].blob) ?? false);
      if (shared.length > 0 || mentions) {
        links.push({
          source: i,
          target: j,
          kind: shared.length > 0 ? 'wikilink' : 'mention',
          weight: 1 + shared.length,
        });
      }
    }
  }

  const nodes: GalaxyNode[] = notes.map((n, i) => ({
    id: i, // id === index — later features rely on this
    label: n.label,
    group: n.group,
    path: n.path,
    excerpt: n.excerpt,
  }));
  return { nodes, links };
}

let cache: { at: number; data: { nodes: GalaxyNode[]; links: GalaxyLink[] } } | null = null;

export async function GET() {
  if (cache && Date.now() - cache.at < CACHE_MS) {
    return NextResponse.json(cache.data);
  }
  const root = process.env.JARVIS_PROJECT_DIR || process.cwd();
  try {
    const data = await buildGraph(root);
    cache = { at: Date.now(), data };
    return NextResponse.json(data);
  } catch (err) {
    console.error('[galaxy] scan failed:', err instanceof Error ? err.message : err);
    return NextResponse.json(
      { error: 'Failed to scan markdown notes.' },
      { status: 500 },
    );
  }
}
