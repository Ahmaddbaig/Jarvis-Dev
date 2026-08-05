import fs from 'fs';
import path from 'path';

export function windowsSystemTool(filename: string): string {
  if (!/^[A-Za-z0-9_.-]+\.exe$/i.test(filename)) {
    throw new Error('Invalid Windows system tool name.');
  }
  const root = process.env.SystemRoot || process.env.windir || 'C:\\Windows';
  const candidates = [
    path.join(root, 'System32', filename),
    path.join(root, 'Sysnative', filename),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || candidates[0];
}

export function windowsChildEnvironment(): NodeJS.ProcessEnv {
  const root = process.env.SystemRoot || process.env.windir || 'C:\\Windows';
  const existing = process.env.Path || process.env.PATH || '';
  const additions = [
    path.join(root, 'System32'),
    root,
    path.join(root, 'System32', 'Wbem'),
    path.join(root, 'System32', 'WindowsPowerShell', 'v1.0'),
  ];
  const seen = new Set(existing.split(';').map((entry) => entry.trim().toLowerCase()).filter(Boolean));
  const merged = [existing, ...additions.filter((entry) => !seen.has(entry.toLowerCase()))]
    .filter(Boolean)
    .join(';');
  return { ...process.env, Path: merged, PATH: merged };
}
