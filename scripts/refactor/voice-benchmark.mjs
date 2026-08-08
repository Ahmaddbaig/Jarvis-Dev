import { readFile } from 'node:fs/promises';
import process from 'node:process';

const EVENT_ORDER = [
  'speech_end',
  'final_transcript',
  'first_model_token',
  'first_tool_proposal',
  'tool_result',
  'first_audio',
  'response_complete',
];
const METRICS = [
  ['transcript_ms', 'speech_end', 'final_transcript'],
  ['first_token_ms', 'speech_end', 'first_model_token'],
  ['tool_proposal_ms', 'speech_end', 'first_tool_proposal'],
  ['tool_execution_ms', 'first_tool_proposal', 'tool_result'],
  ['first_audio_ms', 'speech_end', 'first_audio'],
  ['complete_ms', 'speech_end', 'response_complete'],
];

function usage() {
  console.error('Usage: npm run refactor:voice-benchmark -- <events.jsonl> [--json]');
  console.error('       npm run refactor:voice-benchmark -- --template');
}

function template() {
  const base = Date.now();
  return EVENT_ORDER.map((event, index) => JSON.stringify({
    runId: 'm3-safe-tool-001',
    profile: 'M3',
    provider: 'localai',
    scenario: 'safe_tool',
    event,
    timestampMs: base + (index * 250),
  })).join('\n');
}

function percentile(values, fraction) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.ceil(fraction * sorted.length) - 1);
  return sorted[index];
}

function parseJsonLines(text) {
  const records = [];
  for (const [index, rawLine] of text.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (!line) continue;
    try {
      records.push(JSON.parse(line));
    } catch (error) {
      throw new Error(`Line ${index + 1} is not valid JSON: ${error.message}`);
    }
  }
  return records;
}

function buildRuns(records) {
  const runs = new Map();
  for (const record of records) {
    if (typeof record.runId !== 'string' || !record.runId) throw new Error('Every record needs a non-empty runId.');
    if (!EVENT_ORDER.includes(record.event)) throw new Error(`${record.runId}: unsupported event ${JSON.stringify(record.event)}.`);
    if (!Number.isFinite(record.timestampMs)) throw new Error(`${record.runId}/${record.event}: timestampMs must be finite.`);
    const run = runs.get(record.runId) ?? {
      runId: record.runId,
      profile: record.profile ?? 'unknown',
      provider: record.provider ?? 'unknown',
      scenario: record.scenario ?? 'unknown',
      events: new Map(),
    };
    if (run.events.has(record.event)) throw new Error(`${record.runId}: duplicate ${record.event} event.`);
    run.events.set(record.event, record.timestampMs);
    runs.set(record.runId, run);
  }
  return [...runs.values()];
}

function calculateRun(run) {
  const values = {};
  for (const [name, start, end] of METRICS) {
    const startTime = run.events.get(start);
    const endTime = run.events.get(end);
    if (startTime === undefined || endTime === undefined) continue;
    const duration = endTime - startTime;
    if (duration < 0) throw new Error(`${run.runId}: ${end} occurs before ${start}.`);
    values[name] = duration;
  }
  return { ...run, values };
}

function summarize(runs) {
  const result = {};
  for (const [name] of METRICS) {
    const values = runs.map((run) => run.values[name]).filter(Number.isFinite);
    result[name] = {
      samples: values.length,
      p50: percentile(values, 0.5),
      p95: percentile(values, 0.95),
      min: values.length ? Math.min(...values) : null,
      max: values.length ? Math.max(...values) : null,
    };
  }
  return result;
}

function renderMarkdown(runs, summary) {
  const identities = new Set(runs.map((run) => `${run.profile}/${run.provider}/${run.scenario}`));
  const lines = [
    '# Voice latency benchmark',
    '',
    `Runs: ${runs.length}. Cohorts: ${[...identities].sort().join(', ')}.`,
    '',
    '| Metric | Samples | p50 | p95 | Min | Max |',
    '| --- | ---: | ---: | ---: | ---: | ---: |',
  ];
  for (const [name] of METRICS) {
    const value = summary[name];
    const display = (number) => number === null ? '-' : `${number} ms`;
    lines.push(`| ${name} | ${value.samples} | ${display(value.p50)} | ${display(value.p95)} | ${display(value.min)} | ${display(value.max)} |`);
  }
  return `${lines.join('\n')}\n`;
}

if (process.argv.includes('--template')) {
  process.stdout.write(`${template()}\n`);
} else {
  const inputPath = process.argv.slice(2).find((argument) => !argument.startsWith('--'));
  if (!inputPath) {
    usage();
    process.exitCode = 2;
  } else {
    try {
      const records = parseJsonLines(await readFile(inputPath, 'utf8'));
      const runs = buildRuns(records).map(calculateRun);
      if (runs.length === 0) throw new Error('The input contains no benchmark events.');
      const summary = summarize(runs);
      if (process.argv.includes('--json')) {
        const serializableRuns = runs.map((run) => ({
          runId: run.runId,
          profile: run.profile,
          provider: run.provider,
          scenario: run.scenario,
          values: run.values,
        }));
        process.stdout.write(`${JSON.stringify({ runs: serializableRuns, summary }, null, 2)}\n`);
      } else {
        process.stdout.write(renderMarkdown(runs, summary));
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  }
}
