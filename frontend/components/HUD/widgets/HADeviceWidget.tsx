'use client';
import { getCachedSetting } from '@/frontend/lib/serverSettings';
import { useServerSettings } from '@/frontend/hooks/queries/useServerSettings';
import {
  useHomeAssistantService,
  useHomeAssistantStates,
  type HAEntity,
} from '@/frontend/hooks/queries/useHomeAssistant';

export function HADeviceWidget({ config }: { config?: Record<string, unknown> }) {
  // config.entity_ids: string[] or config.domain: string
  const entityIds  = config?.entity_ids as string[] | undefined;
  const domain     = config?.domain     as string   | undefined;
  const friendlyFilter = config?.name as string | undefined;
  const settingsQuery = useServerSettings();
  const url = settingsQuery.data?.jarvis_ha_url || getCachedSetting('jarvis_ha_url');
  const token = settingsQuery.data?.jarvis_ha_token || getCachedSetting('jarvis_ha_token');
  const statesQuery = useHomeAssistantStates(url, token);
  const serviceMutation = useHomeAssistantService(url, token);
  const all = statesQuery.data ?? [];
  let filtered = all;
  if (entityIds?.length) {
    filtered = all.filter((entity) => entityIds.includes(entity.entity_id));
  } else if (domain) {
    filtered = all.filter((entity) => entity.entity_id.startsWith(domain + '.'));
    if (domain === 'light' && filtered.length === 0) {
      filtered = all.filter((entity) =>
        entity.entity_id.startsWith('switch.')
        && (entity.attributes.friendly_name ?? '').toLowerCase().includes('light')
      );
    }
  } else if (friendlyFilter) {
    filtered = all.filter((entity) =>
      (entity.attributes.friendly_name ?? '').toLowerCase().includes(friendlyFilter.toLowerCase())
    );
  }
  const entities = filtered.slice(0, 6);
  const loading = settingsQuery.isPending || statesQuery.isPending;

  const toggle = async (entity: HAEntity) => {
    const serviceDomain = entity.entity_id.split('.')[0];
    const isOn = ['on','playing','idle','open','unlocked'].includes(entity.state);
    await serviceMutation.mutateAsync({
      domain: serviceDomain,
      service: isOn ? 'turn_off' : 'turn_on',
      entityId: entity.entity_id,
    });
  };

  const setBrightness = async (entity: HAEntity, pct: number) => {
    await serviceMutation.mutateAsync({
      domain: 'light',
      service: 'turn_on',
      entityId: entity.entity_id,
      serviceData: { brightness: Math.round(pct * 2.55) },
    });
  };

  if (loading) return <div className="flex-1 flex items-center justify-center"><div className="w-5 h-5 rounded-full border border-cyan-400/40 border-t-cyan-400 animate-spin" /></div>;
  if (!entities.length) return <div className="flex-1 flex items-center justify-center"><p className="font-mono text-[10px] text-white/25">No devices found</p></div>;

  return (
    <div className="flex flex-col gap-2">
      {entities.map((entity) => {
        const isOn  = ['on','playing','idle','open','unlocked'].includes(entity.state);
        const name  = (entity.attributes.friendly_name as string) ?? entity.entity_id.replace(/^[^.]+\./, '').replace(/_/g, ' ');
        const bPct  = entity.attributes.brightness != null ? Math.round((entity.attributes.brightness as number / 255) * 100) : null;
        const d     = entity.entity_id.split('.')[0];
        const canToggle = ['light','switch','fan','lock','media_player','cover'].includes(d);

        return (
          <div key={entity.entity_id} className="flex flex-col gap-1.5 px-3 py-2.5 rounded-lg"
            style={{ background: isOn ? 'rgba(34,211,238,0.08)' : 'rgba(255,255,255,0.04)', border: `1px solid ${isOn ? 'rgba(34,211,238,0.3)' : 'rgba(255,255,255,0.1)'}` }}>
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-xs font-semibold truncate" style={{ color: isOn ? '#fff' : 'rgba(255,255,255,0.5)' }}>{name}</span>
              {canToggle && (
                <button onClick={() => toggle(entity)}
                  className="relative w-9 h-4 rounded-full shrink-0 transition-all"
                  style={{ background: isOn ? 'rgba(34,211,238,0.3)' : 'rgba(255,255,255,0.1)', border: `1px solid ${isOn ? 'rgba(34,211,238,0.7)' : 'rgba(255,255,255,0.2)'}` }}>
                  <span className="absolute top-0.5 w-3 h-3 rounded-full transition-all duration-200"
                    style={{ left: isOn ? '20px' : '2px', background: isOn ? '#22d3ee' : 'rgba(255,255,255,0.5)', boxShadow: isOn ? '0 0 6px #22d3ee' : 'none' }} />
                </button>
              )}
              {!canToggle && (
                <span className="font-mono text-[10px]" style={{ color: isOn ? '#22d3ee' : 'rgba(255,255,255,0.3)' }}>{entity.state}</span>
              )}
            </div>
            {d === 'light' && bPct !== null && isOn && (
              <div className="flex items-center gap-2">
                <div className="flex-1 h-1 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.08)' }}>
                  <div className="h-full rounded-full" style={{ width: `${bPct}%`, background: '#22d3ee' }} />
                </div>
                <span className="font-mono text-[9px] text-white/30 w-6 text-right">{bPct}%</span>
                <input type="range" min="0" max="100" value={bPct} className="sr-only" onChange={(e) => setBrightness(entity, parseInt(e.target.value) / 100)} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
