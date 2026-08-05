import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();
const API_ROOT = path.join(ROOT, 'app', 'api');
const INVENTORY_PATH = path.join(ROOT, 'docs', 'refactor', 'route-inventory.json');
const METHOD_PATTERN = /export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|OPTIONS)\b/g;
const ALLOWED = {
  exposure: new Set(['lan-proxied', 'desktop-only', 'loopback-extension']),
  auth: new Set([
    'none',
    'desktop-bearer',
    'chrome-ui-bearer',
    'chrome-extension-bearer',
    'extension-origin+pairing-code',
  ]),
  risk: new Set(['read-only', 'low', 'consequential', 'dangerous']),
  priority: new Set(['P0', 'P1', 'P2']),
};

async function findRouteFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return findRouteFiles(fullPath);
    return entry.isFile() && entry.name === 'route.ts' ? [fullPath] : [];
  }));
  return nested.flat();
}

function fileToRoute(filePath) {
  const relative = path.relative(API_ROOT, path.dirname(filePath));
  return `/api/${relative.split(path.sep).join('/')}`;
}

function markdownCell(value) {
  return String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');
}

async function inspectSourceRoutes() {
  const files = await findRouteFiles(API_ROOT);
  const entries = await Promise.all(files.map(async (filePath) => {
    const source = await readFile(filePath, 'utf8');
    const methods = [...source.matchAll(METHOD_PATTERN)].map((match) => match[1]).sort();
    return [fileToRoute(filePath), { filePath, methods }];
  }));
  return new Map(entries);
}

function validateMetadata(entry, errors) {
  for (const field of ['route', 'methods', 'exposure', 'actors', 'auth', 'secretUse', 'sideEffect', 'confirmation', 'capability', 'risk', 'priority']) {
    if (!(field in entry)) errors.push(`${entry.route ?? '<unknown>'}: missing ${field}`);
  }
  for (const [field, allowed] of Object.entries(ALLOWED)) {
    if (!allowed.has(entry[field])) errors.push(`${entry.route}: invalid ${field} ${JSON.stringify(entry[field])}`);
  }
  if (!Array.isArray(entry.methods) || entry.methods.length === 0) errors.push(`${entry.route}: methods must be a non-empty array`);
  if (!Array.isArray(entry.actors) || entry.actors.length === 0) errors.push(`${entry.route}: actors must be a non-empty array`);
  if (entry.exposure === 'desktop-only' && !['desktop-bearer', 'chrome-ui-bearer'].includes(entry.auth)) {
    errors.push(`${entry.route}: desktop-only routes must use a desktop-scoped bearer token`);
  }
  if (entry.exposure === 'lan-proxied' && entry.auth !== 'none') {
    errors.push(`${entry.route}: update the inventory validator when LAN authentication is introduced`);
  }
}

function renderMarkdown(snapshot, routes) {
  const counts = {
    total: routes.length,
    lan: routes.filter((entry) => entry.exposure === 'lan-proxied').length,
    desktop: routes.filter((entry) => entry.exposure === 'desktop-only').length,
    extension: routes.filter((entry) => entry.exposure === 'loopback-extension').length,
    unauthenticated: routes.filter((entry) => entry.auth === 'none').length,
    p0: routes.filter((entry) => entry.priority === 'P0').length,
  };
  const lines = [
    '# API route security inventory',
    '',
    `Snapshot: \`${snapshot.commit}\` on ${snapshot.date}.`,
    '',
    `${counts.total} route handlers are tracked: ${counts.lan} are reachable through the current LAN proxy, ${counts.desktop} are desktop-only, ${counts.extension} are loopback extension endpoints, ${counts.unauthenticated} have no route-level authentication, and ${counts.p0} are P0 migration targets.`,
    '',
    '| Route | Methods | Exposure | Auth | Secret use | Side effect | Confirmation | Capability | Risk | Priority |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const entry of routes) {
    lines.push(`| ${[
      `\`${entry.route}\``,
      entry.methods.join(', '),
      entry.exposure,
      entry.auth,
      entry.secretUse,
      entry.sideEffect,
      entry.confirmation,
      entry.capability,
      entry.risk,
      entry.priority,
    ].map(markdownCell).join(' | ')} |`);
  }
  return `${lines.join('\n')}\n`;
}

const inventory = JSON.parse(await readFile(INVENTORY_PATH, 'utf8'));
const sourceRoutes = await inspectSourceRoutes();
const inventoryRoutes = new Map();
const errors = [];

for (const entry of inventory.routes) {
  validateMetadata(entry, errors);
  if (inventoryRoutes.has(entry.route)) errors.push(`${entry.route}: duplicate inventory entry`);
  inventoryRoutes.set(entry.route, entry);

  const source = sourceRoutes.get(entry.route);
  if (!source) {
    errors.push(`${entry.route}: inventory entry has no route.ts`);
    continue;
  }
  const expectedMethods = [...entry.methods].sort().join(',');
  const actualMethods = source.methods.join(',');
  if (expectedMethods !== actualMethods) {
    errors.push(`${entry.route}: methods are ${actualMethods || '<none>'}, inventory says ${expectedMethods || '<none>'}`);
  }
}

for (const route of sourceRoutes.keys()) {
  if (!inventoryRoutes.has(route)) errors.push(`${route}: route.ts is missing from the inventory`);
}

if (errors.length > 0) {
  console.error('Route inventory validation failed:');
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else if (process.argv.includes('--check')) {
  console.log(`Route inventory is complete for ${inventory.routes.length} handlers.`);
} else {
  process.stdout.write(renderMarkdown(inventory.snapshot, inventory.routes));
}
