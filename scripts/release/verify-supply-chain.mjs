import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const lock = JSON.parse(readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
const failures = [];
const internalPackages = new Set([
  'jarvis-client', 'jarvis-companion', '@jarvis/contracts', '@jarvis/core', '@jarvis/persistence', '@jarvis/secrets',
]);

function packageName(lockPath, entry) {
  if (entry.name) return entry.name;
  return lockPath.split('node_modules/').at(-1) || lockPath;
}

let productionPackages = 0;
for (const [lockPath, entry] of Object.entries(lock.packages ?? {})) {
  if (!lockPath || entry.link) continue;
  const name = packageName(lockPath, entry);
  if (entry.resolved?.startsWith('http') && !entry.integrity) {
    failures.push(`Lock entry ${name} has a remote archive without an integrity hash.`);
  }
  if (/^(?:git\+|git:)/.test(entry.resolved ?? '') && !/[a-f0-9]{40}(?:$|[#?])/.test(entry.resolved)) {
    failures.push(`Git dependency ${name} is not pinned to a full commit.`);
  }
  if (entry.dev === true || entry.devOptional === true) continue;
  productionPackages += 1;
  const declaredLicense = typeof entry.license === 'string' ? entry.license.trim() : '';
  if (!declaredLicense && !internalPackages.has(name)) failures.push(`Production package ${name} has no declared license.`);
  if (/\b(?:AGPL|SSPL|BUSL)\b|Commons Clause|(?:^|[^L])GPL(?:-|\b)/i.test(declaredLicense)) {
    failures.push(`Production package ${name} uses disallowed license ${declaredLicense}.`);
  }
}

const signatureParts = {
  openai: [['s', 'k'].join(''), '(?:(?:proj|svcacct)-[A-Za-z0-9_-]{40,}|[A-Za-z0-9]{40,})'],
  anthropic: [['s', 'k'].join(''), 'ant-api03', '[A-Za-z0-9_-]{40,}'],
  github: ['gh', '[pousr]_', '[A-Za-z0-9]{30,}'],
  google: ['AI', 'za', '[A-Za-z0-9_-]{35}'],
  aws: ['AK', 'IA', '[0-9A-Z]{16}'],
};
const secretPatterns = [
  ['OpenAI key', new RegExp(`\\b${signatureParts.openai.join('-')}\\b`)],
  ['Anthropic key', new RegExp(`\\b${signatureParts.anthropic.join('-')}\\b`)],
  ['GitHub token', new RegExp(`\\b${signatureParts.github.join('')}\\b`)],
  ['Google API key', new RegExp(`\\b${signatureParts.google.join('')}\\b`)],
  ['AWS access key', new RegExp(`\\b${signatureParts.aws.join('')}\\b`)],
  ['Private key', new RegExp(['-----BE', 'GIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----'].join(''))],
];
const tracked = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root });
let scannedFiles = 0;
for (const rawName of tracked.toString('utf8').split('\0').filter(Boolean)) {
  const absolute = path.join(root, rawName);
  let bytes;
  try { bytes = readFileSync(absolute); } catch { continue; }
  if (bytes.length > 5_000_000 || bytes.includes(0)) continue;
  scannedFiles += 1;
  const content = bytes.toString('utf8');
  for (const [label, pattern] of secretPatterns) {
    if (pattern.test(content)) failures.push(`${rawName}: resembles a ${label}.`);
  }
}

if (failures.length) {
  console.error('Supply-chain verification failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Supply-chain verification passed (${productionPackages} production lock entries, ${scannedFiles} source text files).`);
}
