import { spawnSync } from 'node:child_process';
import process from 'node:process';

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const includeInstall = process.argv.includes('--install');
const checks = [
  {
    name: 'Route inventory',
    command: process.execPath,
    args: ['scripts/refactor/validate-route-inventory.mjs', '--check'],
  },
  { name: 'Vitest', command: npmCommand, args: ['test'] },
  { name: 'ESLint', command: npmCommand, args: ['run', 'lint'] },
  {
    name: 'TypeScript',
    command: npmCommand,
    args: ['run', 'typecheck'],
  },
  { name: 'Next production build', command: npmCommand, args: ['run', 'build:next'] },
  { name: 'Electron source build', command: npmCommand, args: ['run', 'build:electron'] },
  { name: 'Python bundle build', command: npmCommand, args: ['run', 'build:python'] },
];

if (includeInstall) {
  checks.unshift({ name: 'Clean dependency install', command: npmCommand, args: ['ci'] });
}

const results = [];
for (const check of checks) {
  console.log(`\n[baseline] ${check.name}`);
  const startedAt = performance.now();
  const result = spawnSync(check.command, check.args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
  });
  const durationMs = Math.round(performance.now() - startedAt);
  const status = result.status ?? 1;
  results.push({ name: check.name, status, durationMs });
  if (result.error) console.error(result.error.message);
}

console.log('\nBaseline summary');
console.log('| Check | Result | Duration |');
console.log('| --- | --- | ---: |');
for (const result of results) {
  console.log(`| ${result.name} | ${result.status === 0 ? 'PASS' : `FAIL (${result.status})`} | ${(result.durationMs / 1000).toFixed(1)} s |`);
}

const failures = results.filter((result) => result.status !== 0);
if (failures.length > 0) {
  console.error(`\n${failures.length} baseline check(s) failed.`);
  process.exitCode = 1;
} else {
  console.log('\nAll baseline checks passed. This does not replace native hardware and packaging smoke tests.');
}
