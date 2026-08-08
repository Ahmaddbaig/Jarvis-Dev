import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const eslintPath = path.join(root, 'node_modules', 'eslint', 'bin', 'eslint.js');
const baselinePath = path.join(root, 'docs', 'refactor', 'lint-baseline.json');
const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
const result = spawnSync(process.execPath, [eslintPath, '--format', 'json'], {
  cwd: root,
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
});

if (result.error) throw result.error;
if (!result.stdout.trim()) {
  process.stderr.write(result.stderr || 'ESLint did not produce a report.\n');
  process.exit(1);
}

let reports;
try {
  reports = JSON.parse(result.stdout);
} catch (error) {
  process.stderr.write(result.stderr || 'ESLint returned an invalid JSON report.\n');
  throw error;
}

const errors = [];
const warningCounts = new Map();
for (const report of reports) {
  for (const message of report.messages) {
    const rule = message.ruleId || '<unattributed>';
    if (message.severity === 2) {
      errors.push(`${path.relative(root, report.filePath)}:${message.line}:${message.column} ${rule} ${message.message}`);
    } else if (message.severity === 1) {
      warningCounts.set(rule, (warningCounts.get(rule) || 0) + 1);
    }
  }
}

const budgetFailures = [];
let totalWarnings = 0;
for (const [rule, count] of [...warningCounts].sort(([left], [right]) => left.localeCompare(right))) {
  totalWarnings += count;
  const budget = baseline.rules[rule];
  if (budget === undefined) budgetFailures.push(`${rule}: ${count} new warning(s), no baseline allowance`);
  else if (count > budget) budgetFailures.push(`${rule}: ${count} warning(s), budget is ${budget}`);
}
if (totalWarnings > baseline.maxWarnings) {
  budgetFailures.push(`total: ${totalWarnings} warning(s), budget is ${baseline.maxWarnings}`);
}

console.log(`ESLint: ${errors.length} error(s), ${totalWarnings} warning(s) across ${warningCounts.size} budgeted rules.`);
for (const [rule, count] of [...warningCounts].sort(([left], [right]) => left.localeCompare(right))) {
  console.log(`- ${rule}: ${count}/${baseline.rules[rule] ?? 0}`);
}

if (errors.length > 0) {
  console.error('\nESLint errors:');
  for (const error of errors) console.error(`- ${error}`);
}
if (budgetFailures.length > 0) {
  console.error('\nLint budget failures:');
  for (const failure of budgetFailures) console.error(`- ${failure}`);
}
if (errors.length > 0 || budgetFailures.length > 0 || (result.status !== 0 && errors.length === 0)) {
  process.exitCode = 1;
}
