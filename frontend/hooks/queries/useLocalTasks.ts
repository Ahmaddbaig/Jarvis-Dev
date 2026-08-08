'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { LocalTask } from '@jarvis/contracts';
import { fetchJson } from '@/frontend/lib/query/fetchJson';
import { queryKeys } from '@/frontend/lib/query/keys';

interface TasksResponse {
  tasks: LocalTask[];
}

export function useLocalTasks() {
  return useQuery({
    queryKey: queryKeys.calendar.tasks(),
    queryFn: async ({ signal }) => (await fetchJson<TasksResponse>('/api/tasks', {}, signal)).tasks,
    staleTime: 30_000,
  });
}

export function useReplaceLocalTasks() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (tasks: readonly LocalTask[]) => {
      const response = await fetchJson<TasksResponse>('/api/tasks', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tasks }),
      });
      return response.tasks;
    },
    onMutate: async (tasks) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.calendar.tasks() });
      const previous = queryClient.getQueryData<LocalTask[]>(queryKeys.calendar.tasks());
      queryClient.setQueryData(queryKeys.calendar.tasks(), [...tasks]);
      return { previous };
    },
    onError: (_error, _tasks, context) => {
      if (context?.previous) queryClient.setQueryData(queryKeys.calendar.tasks(), context.previous);
    },
    onSuccess: (tasks) => queryClient.setQueryData(queryKeys.calendar.tasks(), tasks),
  });
}
