import type { DatabaseSync } from 'node:sqlite';
import { localTaskSchema, type LocalTask } from '@jarvis/contracts';

interface TaskRow {
  id: string;
  due_date: string;
  text: string;
  completed: number;
  time_label: string | null;
}

function assertTask(task: LocalTask): void {
  localTaskSchema.parse(task);
}

export class TasksRepository {
  constructor(private readonly database: DatabaseSync) {}

  list(scope = 'local'): LocalTask[] {
    const rows = this.database.prepare(`
      SELECT id, due_date, text, completed, time_label
      FROM tasks
      WHERE scope = ?
      ORDER BY due_date, created_at, id
    `).all(scope) as unknown as TaskRow[];
    return rows.map((row) => ({
      id: row.id,
      date: row.due_date,
      text: row.text,
      done: row.completed === 1,
      ...(row.time_label ? { time: row.time_label } : {}),
    }));
  }

  replaceAll(tasks: readonly LocalTask[], scope = 'local'): void {
    for (const task of tasks) assertTask(task);
    const now = new Date().toISOString();
    const insert = this.database.prepare(`
      INSERT INTO tasks (id, scope, due_date, text, completed, time_label, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const ownsTransaction = !this.database.isTransaction;
    if (ownsTransaction) this.database.exec('BEGIN IMMEDIATE');
    try {
      this.database.prepare('DELETE FROM tasks WHERE scope = ?').run(scope);
      for (const task of tasks) {
        insert.run(task.id, scope, task.date, task.text, task.done ? 1 : 0, task.time ?? null, now, now);
      }
      if (ownsTransaction) this.database.exec('COMMIT');
    } catch (error) {
      if (ownsTransaction && this.database.isTransaction) this.database.exec('ROLLBACK');
      throw error;
    }
  }

  upsert(task: LocalTask, scope = 'local'): void {
    assertTask(task);
    const now = new Date().toISOString();
    this.database.prepare(`
      INSERT INTO tasks (id, scope, due_date, text, completed, time_label, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        scope = excluded.scope,
        due_date = excluded.due_date,
        text = excluded.text,
        completed = excluded.completed,
        time_label = excluded.time_label,
        updated_at = excluded.updated_at
    `).run(task.id, scope, task.date, task.text, task.done ? 1 : 0, task.time ?? null, now, now);
  }

  delete(id: string, scope = 'local'): boolean {
    return this.database.prepare('DELETE FROM tasks WHERE id = ? AND scope = ?').run(id, scope).changes > 0;
  }
}
