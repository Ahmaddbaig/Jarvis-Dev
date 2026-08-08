import { readdirSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const required = process.argv.includes('--required');
const preflight = process.argv.includes('--preflight');
// Set by jobs that just produced the bundles: "nothing to check" is a build
// failure there, not a skip.
const expectBundles = process.argv.includes('--expect-bundles');
const requestedPlatform = process.argv.find((argument) => argument.startsWith('--platform='))?.split('=')[1];
const platform = requestedPlatform === 'mac' ? 'darwin' : requestedPlatform === 'win' ? 'win32' : process.platform;

function fail(message) {
  console.error(`Signing verification failed: ${message}`);
  process.exit(1);
}

function requireEnvironment(names, label) {
  const missing = names.filter((name) => !process.env[name]);
  if (missing.length) fail(`${label} is missing CI secrets: ${missing.join(', ')}.`);
}

if (preflight) {
  if (platform === 'darwin') {
    requireEnvironment(['CSC_LINK', 'CSC_KEY_PASSWORD'], 'macOS signing');
    const appleId = ['APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID'].every((name) => process.env[name]);
    const apiKey = ['APPLE_API_KEY', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER'].every((name) => process.env[name]);
    const keychain = ['APPLE_KEYCHAIN', 'APPLE_KEYCHAIN_PROFILE'].every((name) => process.env[name]);
    if (!appleId && !apiKey && !keychain) fail('macOS notarization credentials are incomplete.');
  } else if (platform === 'win32') {
    if (!(process.env.WIN_CSC_LINK || process.env.CSC_LINK)) fail('Windows signing certificate is missing.');
    if (!(process.env.WIN_CSC_KEY_PASSWORD || process.env.CSC_KEY_PASSWORD)) fail('Windows signing password is missing.');
  }
  console.log(`Signing preflight passed for ${platform}.`);
  process.exit(0);
}

function findBundles(directory, names, depth = 0) {
  if (depth > 4) return [];
  let entries;
  try { entries = readdirSync(directory, { withFileTypes: true }); } catch { return []; }
  const found = [];
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory() && names.has(entry.name)) found.push(absolute);
    else if (entry.isDirectory() && !entry.name.endsWith('.app')) found.push(...findBundles(absolute, names, depth + 1));
  }
  return found;
}

function findFiles(directory, names, depth = 0) {
  if (depth > 4) return [];
  let entries;
  try { entries = readdirSync(directory, { withFileTypes: true }); } catch { return []; }
  const found = [];
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isFile() && names.has(entry.name)) found.push(absolute);
    else if (entry.isDirectory()) found.push(...findFiles(absolute, names, depth + 1));
  }
  return found;
}

function run(command, args, label) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) fail(`${label}: ${(result.stderr || result.stdout || 'command failed').trim()}`);
}

if (platform === 'darwin') {
  const bundles = [
    ...findBundles(path.join(root, 'release'), new Set(['Jarvis.app'])),
    ...findBundles(path.join(root, 'apps', 'companion', 'dist'), new Set(['Jarvis Companion.app'])),
  ];
  if (!bundles.length) {
    if (required || expectBundles) fail('No macOS application bundles were found.');
    console.log('No macOS application bundles found; signature check skipped.');
    process.exit(0);
  }
  let signed = 0;
  for (const bundle of bundles) {
    const signature = spawnSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', bundle], {
      cwd: root,
      encoding: 'utf8',
    });
    if (signature.status !== 0) {
      if (required) fail(`${path.basename(bundle)}: ${(signature.stderr || signature.stdout || 'unsigned').trim()}`);
      continue;
    }
    signed += 1;
    if (required) {
      run('/usr/sbin/spctl', ['--assess', '--type', 'execute', '--verbose=2', bundle], `${path.basename(bundle)} Gatekeeper`);
      run('/usr/bin/xcrun', ['stapler', 'validate', bundle], `${path.basename(bundle)} notarization`);
    }
  }
  console.log(`macOS signature state: ${signed} signed, ${bundles.length - signed} unsigned verification candidate(s).`);
} else if (platform === 'win32') {
  const candidates = [
    ...findFiles(path.join(root, 'release'), new Set(['Jarvis.exe'])),
    ...findFiles(path.join(root, 'apps', 'companion', 'dist'), new Set(['Jarvis Companion.exe'])),
  ];
  if (!candidates.length) {
    if (required || expectBundles) fail('No Windows application executables were found.');
    console.log('No Windows application executables found; signature check skipped.');
    process.exit(0);
  }
  let signed = 0;
  for (const candidate of candidates) {
    const escaped = candidate.replaceAll("'", "''");
    const signature = spawnSync('powershell', [
      '-NoProfile', '-Command',
      `if ((Get-AuthenticodeSignature -LiteralPath '${escaped}').Status -ne 'Valid') { exit 1 }`,
    ], { cwd: root, encoding: 'utf8' });
    if (signature.status !== 0) {
      if (required) fail(`${path.basename(candidate)} is not Authenticode-signed.`);
      continue;
    }
    signed += 1;
  }
  console.log(`Windows signature state: ${signed} signed, ${candidates.length - signed} unsigned verification candidate(s).`);
} else {
  console.log('Native signing verification is not applicable on this platform.');
}
