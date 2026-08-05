'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchJson } from '@/frontend/lib/query/fetchJson';
import { queryKeys } from '@/frontend/lib/query/keys';

export interface HAEntity {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown> & {
    friendly_name?: string;
    device_class?: string;
    brightness?: number;
    current_temperature?: number;
    temperature?: number;
    unit_of_measurement?: string;
    media_title?: string;
    media_artist?: string;
    volume_level?: number;
    source?: string;
    source_list?: string[];
    supported_features?: number;
    icon?: string;
  };
  last_changed: string;
}

export interface HAServiceInput {
  domain: string;
  service: string;
  entityId: string;
  serviceData?: Record<string, unknown>;
}

export function useHomeAssistantStates(baseUrl: string, token: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.homeAssistant.states(baseUrl),
    queryFn: ({ signal }) => fetchJson<HAEntity[]>(
      `/api/home-assistant?url=${encodeURIComponent(baseUrl)}&token=${encodeURIComponent(token)}&path=/api/states`,
      {},
      signal,
    ),
    enabled: enabled && Boolean(baseUrl && token),
    staleTime: 4_000,
    refetchInterval: enabled && baseUrl && token ? 5_000 : false,
    refetchIntervalInBackground: false,
  });
}

function applyOptimisticService(entity: HAEntity, input: HAServiceInput): HAEntity {
  if (entity.entity_id !== input.entityId) return entity;
  const serviceData = input.serviceData ?? {};
  if (input.service === 'turn_on') return { ...entity, state: 'on', attributes: { ...entity.attributes, ...serviceData } };
  if (input.service === 'turn_off') return { ...entity, state: 'off' };
  if (input.service === 'toggle') {
    return { ...entity, state: ['on', 'idle', 'playing'].includes(entity.state) ? 'off' : 'on' };
  }
  if (input.service === 'select_source') {
    return { ...entity, attributes: { ...entity.attributes, source: serviceData.source as string } };
  }
  if (input.service === 'volume_set') {
    return { ...entity, attributes: { ...entity.attributes, volume_level: serviceData.volume_level as number } };
  }
  return { ...entity, attributes: { ...entity.attributes, ...serviceData } };
}

export function useHomeAssistantService(baseUrl: string, token: string) {
  const queryClient = useQueryClient();
  const key = queryKeys.homeAssistant.states(baseUrl);
  return useMutation({
    mutationFn: (input: HAServiceInput) => fetchJson<{ success?: boolean }>('/api/home-assistant', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: baseUrl,
        token,
        domain: input.domain,
        service: input.service,
        serviceData: { entity_id: input.entityId, ...(input.serviceData ?? {}) },
      }),
    }),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<HAEntity[]>(key);
      queryClient.setQueryData<HAEntity[]>(key, (current) =>
        (current ?? []).map((entity) => applyOptimisticService(entity, input))
      );
      return { previous };
    },
    onError: (_error, _input, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
    },
    onSettled: () => {
      window.setTimeout(() => {
        void queryClient.invalidateQueries({ queryKey: key });
      }, 1_500);
    },
  });
}
