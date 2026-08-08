import type { LocalTask } from '@jarvis/contracts';

export async function fetchLocalTasks(): Promise<LocalTask[]> {
  const response = await fetch('/api/tasks', { cache: 'no-store' });
  if (!response.ok) throw new Error(`Tasks returned HTTP ${response.status}.`);
  const body = await response.json() as { tasks?: unknown };
  return Array.isArray(body.tasks) ? body.tasks as LocalTask[] : [];
}

export function groupLocalTasks(tasks: readonly LocalTask[]): Record<string, LocalTask[]> {
  const grouped: Record<string, LocalTask[]> = {};
  for (const task of tasks) (grouped[task.date] ??= []).push(task);
  return grouped;
}
