import { z } from 'zod';

export const localTaskSchema = z.object({
  id: z.string().min(1).max(128),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
  }, 'Task date must be a real calendar date.'),
  text: z.string().trim().min(1).max(4_096),
  done: z.boolean(),
  time: z.string().max(128).optional(),
}).strict();

export const localTaskListSchema = z.array(localTaskSchema).max(10_000).superRefine((tasks, context) => {
  const ids = new Set<string>();
  for (const [index, task] of tasks.entries()) {
    if (ids.has(task.id)) {
      context.addIssue({ code: 'custom', path: [index, 'id'], message: 'Task IDs must be unique.' });
    }
    ids.add(task.id);
  }
});

export type LocalTask = z.infer<typeof localTaskSchema>;
