import { describe, expect, it } from 'vitest';
import { localTaskListSchema, localTaskSchema } from '../packages/contracts/src';

describe('local task contract', () => {
  it('accepts bounded local calendar tasks', () => {
    expect(localTaskSchema.parse({
      id: 'task-1',
      date: '2026-08-05',
      text: 'Run the recovery drill',
      done: false,
      time: '3:00 PM',
    })).toMatchObject({ id: 'task-1', date: '2026-08-05' });
  });

  it('rejects impossible dates and unbounded text', () => {
    expect(localTaskSchema.safeParse({
      id: 'task-1', date: '2026-02-30', text: 'Invalid date', done: false,
    }).success).toBe(false);
    expect(localTaskSchema.safeParse({
      id: 'task-1', date: '2026-08-05', text: 'x'.repeat(4_097), done: false,
    }).success).toBe(false);
  });

  it('rejects duplicate IDs before a replacement transaction begins', () => {
    expect(localTaskListSchema.safeParse([
      { id: 'same', date: '2026-08-05', text: 'First', done: false },
      { id: 'same', date: '2026-08-06', text: 'Second', done: false },
    ]).success).toBe(false);
  });
});
