'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { emitError } from '@/frontend/lib/errorBus';

/**
 * Knowledge-galaxy main screen: renders every markdown note in the project as
 * a glowing star, clustered by folder and linked by title mentions and shared
 * [[wikilinks]]. Fills the viewport behind the HUD widgets (z-[2], under the
 * z-10/z-20 widget layers and the z-[80] chat panel).
 *
 * Data comes from /api/galaxy (freshly scanned server-side). The camera is
 * animated by hand — rAF over instant cameraPosition() sets — because the
 * library's built-in tweens conflict with OrbitControls autoRotate.
 */

interface GalaxyNode {
  id: number;
  label: string;
  group: string;
  path: string;
  excerpt: string;
  x?: number;
  y?: number;
  z?: number;
  __mat?: THREE.SpriteMaterial;
  __sprite?: THREE.Sprite;
  __size?: number;
}

interface GalaxyLink {
  source: number | GalaxyNode;
  target: number | GalaxyNode;
  kind: string;
  weight: number;
}

type ForceGraphInstance = {
  (el: HTMLElement): ForceGraphInstance;
  graphData: (d: { nodes: GalaxyNode[]; links: GalaxyLink[] }) => ForceGraphInstance;
  backgroundColor: (c: string) => ForceGraphInstance;
  nodeLabel: (fn: (n: GalaxyNode) => string) => ForceGraphInstance;
  nodeThreeObject: (fn: (n: GalaxyNode) => THREE.Object3D) => ForceGraphInstance;
  linkColor: {
    (): (l: GalaxyLink) => string;
    (fn: (l: GalaxyLink) => string): ForceGraphInstance;
  };
  linkWidth: {
    (): (l: GalaxyLink) => number;
    (fn: (l: GalaxyLink) => number): ForceGraphInstance;
  };
  linkDirectionalParticles: {
    (): (l: GalaxyLink) => number;
    (fn: (l: GalaxyLink) => number): ForceGraphInstance;
  };
  linkDirectionalParticleSpeed: (v: number) => ForceGraphInstance;
  linkDirectionalParticleWidth: (v: number) => ForceGraphInstance;
  onNodeClick: (fn: (n: GalaxyNode) => void) => ForceGraphInstance;
  onNodeHover: (fn: (n: GalaxyNode | null) => void) => ForceGraphInstance;
  onBackgroundClick: (fn: () => void) => ForceGraphInstance;
  onEngineStop: (fn: () => void) => ForceGraphInstance;
  cameraPosition: {
    (): { x: number; y: number; z: number; lookAt: { x: number; y: number; z: number } };
    (pos: { x: number; y: number; z: number }, lookAt?: unknown, ms?: number): ForceGraphInstance;
  };
  getGraphBbox: () => { x: [number, number]; y: [number, number]; z: [number, number] } | null;
  scene: () => THREE.Scene;
  controls: () => { autoRotate: boolean; autoRotateSpeed: number; addEventListener: (e: string, cb: () => void) => void };
  width: (w: number) => ForceGraphInstance;
  height: (h: number) => ForceGraphInstance;
  _destructor: () => void;
};

export function GalaxyScreen({ onOpenSettings }: { onOpenSettings: () => void }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const graphRef = useRef<ForceGraphInstance | null>(null);
  const nodesRef = useRef<GalaxyNode[]>([]);
  const neighborsRef = useRef<Map<number, Set<number>>>(new Map());
  const nodeLinksRef = useRef<Map<number, GalaxyLink[]>>(new Map());
  const groupColorRef = useRef<Map<string, string>>(new Map());
  const selectedRef = useRef<GalaxyNode | null>(null);
  const hlNodesRef = useRef<Set<number>>(new Set());
  const hlLinksRef = useRef<Set<GalaxyLink>>(new Set());
  const spinAfterFlyRef = useRef(true);
  const flightIdRef = useRef(0);
  const disposedRef = useRef(false);

  // Snapshot of the selected note for the side panel — captured in the
  // selection handler so render never reads the imperative refs.
  interface PanelData {
    node: GalaxyNode;
    color?: string;
    neighbors: { id: number; label: string; group: string; color?: string }[];
  }
  const [panel, setPanel] = useState<PanelData | null>(null);
  const [stats, setStats] = useState<{ notes: number; links: number } | null>(null);
  const [groups, setGroups] = useState<{ name: string; color: string; count: number }[]>([]);
  const [error, setError] = useState<string | null>(null);

  const flyTo = useCallback((
    pos: { x: number; y: number; z: number },
    lookAt: { x: number; y: number; z: number },
    ms: number,
  ) => {
    const Graph = graphRef.current;
    if (!Graph) return;
    const id = ++flightIdRef.current;
    const controls = Graph.controls();
    controls.autoRotate = false;
    const start = Graph.cameraPosition();
    const from = {
      x: start.x, y: start.y, z: start.z,
      lx: start.lookAt.x, ly: start.lookAt.y, lz: start.lookAt.z,
    };
    const to = { x: pos.x, y: pos.y, z: pos.z, lx: lookAt.x, ly: lookAt.y, lz: lookAt.z };
    const t0 = performance.now();
    const step = (now: number) => {
      if (disposedRef.current || id !== flightIdRef.current) return;
      const t = Math.min(1, (now - t0) / ms);
      const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      Graph.cameraPosition(
        {
          x: from.x + (to.x - from.x) * e,
          y: from.y + (to.y - from.y) * e,
          z: from.z + (to.z - from.z) * e,
        },
        {
          x: from.lx + (to.lx - from.lx) * e,
          y: from.ly + (to.ly - from.ly) * e,
          z: from.lz + (to.lz - from.lz) * e,
        },
        0,
      );
      if (t < 1) requestAnimationFrame(step);
      else setTimeout(() => {
        if (!disposedRef.current && id === flightIdRef.current) {
          controls.autoRotate = spinAfterFlyRef.current;
        }
      }, 150);
    };
    requestAnimationFrame(step);
  }, []);

  const frameGalaxy = useCallback((ms = 1800) => {
    const Graph = graphRef.current;
    if (!Graph) return;
    const b = Graph.getGraphBbox();
    if (!b) return;
    const c = { x: (b.x[0] + b.x[1]) / 2, y: (b.y[0] + b.y[1]) / 2, z: (b.z[0] + b.z[1]) / 2 };
    const radius = Math.max(b.x[1] - b.x[0], b.y[1] - b.y[0], b.z[1] - b.z[0], 60) / 2;
    const cam = Graph.cameraPosition();
    const d = { x: cam.x - c.x, y: cam.y - c.y, z: cam.z - c.z };
    const len = Math.hypot(d.x, d.y, d.z) || 1;
    const dist = radius * 2.6;
    flyTo(
      { x: c.x + (d.x / len) * dist, y: c.y + (d.y / len) * dist, z: c.z + (d.z / len) * dist },
      c,
      ms,
    );
  }, [flyTo]);

  const updateVisuals = useCallback(() => {
    const Graph = graphRef.current;
    if (!Graph) return;
    const sel = selectedRef.current;
    for (const n of nodesRef.current) {
      if (!n.__mat || !n.__sprite || !n.__size) continue;
      const active = !sel || hlNodesRef.current.has(n.id);
      n.__mat.opacity = active ? 1 : 0.08;
      const s = n.id === sel?.id ? n.__size * 1.6 : n.__size;
      n.__sprite.scale.set(s, s, 1);
    }
    // Re-assign accessors so link materials/particles re-evaluate.
    Graph
      .linkColor(Graph.linkColor())
      .linkWidth(Graph.linkWidth())
      .linkDirectionalParticles(Graph.linkDirectionalParticles());
  }, []);

  const selectNode = useCallback((node: GalaxyNode) => {
    selectedRef.current = node;
    hlNodesRef.current = new Set([node.id, ...(neighborsRef.current.get(node.id) ?? [])]);
    hlLinksRef.current = new Set(nodeLinksRef.current.get(node.id) ?? []);
    spinAfterFlyRef.current = false;
    setPanel({
      node,
      color: groupColorRef.current.get(node.group),
      neighbors: [...(neighborsRef.current.get(node.id) ?? [])]
        .map((id) => nodesRef.current[id]) // id === index — guaranteed by /api/galaxy
        .filter(Boolean)
        .sort((a, b) =>
          (neighborsRef.current.get(b.id)?.size ?? 0) - (neighborsRef.current.get(a.id)?.size ?? 0))
        .map((n) => ({
          id: n.id,
          label: n.label,
          group: n.group,
          color: groupColorRef.current.get(n.group),
        })),
    });

    const dist = 140;
    const len = Math.hypot(node.x ?? 0, node.y ?? 0, node.z ?? 0) || 1;
    const ratio = 1 + dist / len;
    flyTo(
      { x: (node.x ?? 0) * ratio, y: (node.y ?? 0) * ratio, z: (node.z ?? 0) * ratio },
      { x: node.x ?? 0, y: node.y ?? 0, z: node.z ?? 0 },
      1600,
    );
    updateVisuals();
  }, [flyTo, updateVisuals]);

  const clearSelection = useCallback(() => {
    if (!selectedRef.current) return;
    selectedRef.current = null;
    hlNodesRef.current = new Set();
    hlLinksRef.current = new Set();
    spinAfterFlyRef.current = true;
    setPanel(null);
    updateVisuals();
    setTimeout(() => {
      const Graph = graphRef.current;
      if (Graph && !selectedRef.current && !disposedRef.current) {
        Graph.controls().autoRotate = true;
      }
    }, 4000);
  }, [updateVisuals]);

  useEffect(() => {
    disposedRef.current = false;
    let cancelled = false;

    (async () => {
      const container = containerRef.current;
      if (!container) return;

      let data: { nodes: GalaxyNode[]; links: GalaxyLink[] };
      try {
        const res = await fetch('/api/galaxy');
        if (!res.ok) throw new Error(`scan failed (${res.status})`);
        data = (await res.json()) as { nodes: GalaxyNode[]; links: GalaxyLink[] };
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
        return;
      }
      // Loaded on demand: three + 3d-force-graph are ~1.5 MB and only needed
      // when the galaxy main screen is active.
      const { default: ForceGraph3D } = await import('3d-force-graph');
      if (cancelled || !containerRef.current) return;

      const nodes = data.nodes;
      const links = data.links;
      nodesRef.current = nodes;

      const groupNames = [...new Set(nodes.map((n) => n.group))].sort();
      const groupColor = new Map(groupNames.map((g, i) =>
        // Comma syntax: valid CSS *and* parseable by THREE.Color.
        [g, `hsl(${Math.round(i * 137.508) % 360}, 85%, 62%)`]));
      groupColorRef.current = groupColor;

      const neighbors = new Map<number, Set<number>>();
      const nodeLinks = new Map<number, GalaxyLink[]>();
      for (const n of nodes) {
        neighbors.set(n.id, new Set());
        nodeLinks.set(n.id, []);
      }
      for (const l of links) {
        const s = l.source as number;
        const t = l.target as number;
        neighbors.get(s)?.add(t);
        neighbors.get(t)?.add(s);
        nodeLinks.get(s)?.push(l);
        nodeLinks.get(t)?.push(l);
      }
      neighborsRef.current = neighbors;
      nodeLinksRef.current = nodeLinks;

      setStats({ notes: nodes.length, links: links.length });
      setGroups(groupNames.map((g) => ({
        name: g,
        color: groupColor.get(g)!,
        count: nodes.filter((n) => n.group === g).length,
      })));

      const glowTexture = (() => {
        const c = document.createElement('canvas');
        c.width = c.height = 128;
        const ctx = c.getContext('2d')!;
        const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
        g.addColorStop(0, 'rgba(255,255,255,1)');
        g.addColorStop(0.1, 'rgba(255,255,255,0.9)');
        g.addColorStop(0.32, 'rgba(255,255,255,0.45)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, 128, 128);
        return new THREE.CanvasTexture(c);
      })();

      const Graph = (ForceGraph3D as unknown as (config?: object) => ForceGraphInstance)({
        controlType: 'orbit',
      })(container)
        .backgroundColor('#000004')
        .graphData({ nodes, links })
        .nodeLabel((n) => `${n.label}  ·  ${n.group}`)
        .nodeThreeObject((node) => {
          const material = new THREE.SpriteMaterial({
            map: glowTexture,
            color: new THREE.Color(groupColor.get(node.group)),
            transparent: true,
            opacity: 1,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
          });
          const sprite = new THREE.Sprite(material);
          const size = 7 + Math.sqrt(neighbors.get(node.id)?.size ?? 0) * 3.5;
          sprite.scale.set(size, size, 1);
          node.__mat = material;
          node.__size = size;
          node.__sprite = sprite;
          return sprite;
        })
        .linkColor((link) => selectedRef.current
          ? (hlLinksRef.current.has(link) ? 'rgba(140,240,255,0.95)' : 'rgba(90,140,255,0.05)')
          : 'rgba(110,170,255,0.3)')
        .linkWidth((link) => hlLinksRef.current.has(link) ? 1.4 : 0.4)
        .linkDirectionalParticles((link) => hlLinksRef.current.has(link) ? 3 : 0)
        .linkDirectionalParticleSpeed(0.006)
        .linkDirectionalParticleWidth(1.8)
        .onNodeClick(selectNode)
        .onNodeHover((n) => { document.body.style.cursor = n ? 'pointer' : 'default'; })
        .onBackgroundClick(clearSelection);
      graphRef.current = Graph;

      Graph.cameraPosition({ x: 0, y: 0, z: 850 });
      Graph.width(window.innerWidth).height(window.innerHeight);

      // Starfield — far shell of tinted points, slowly drifting.
      {
        const COUNT = 6000;
        const pos = new Float32Array(COUNT * 3);
        const col = new Float32Array(COUNT * 3);
        const tints = ['#ffffff', '#bfd9ff', '#9bd4ff', '#ffe4b8'].map((t) => new THREE.Color(t));
        for (let i = 0; i < COUNT; i++) {
          const v = new THREE.Vector3().randomDirection()
            .multiplyScalar(2200 + Math.random() * 2600);
          pos.set([v.x, v.y, v.z], i * 3);
          const t = tints[(Math.random() * tints.length) | 0];
          const dim = 0.35 + Math.random() * 0.65;
          col.set([t.r * dim, t.g * dim, t.b * dim], i * 3);
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
        const stars = new THREE.Points(geo, new THREE.PointsMaterial({
          size: 2.4,
          vertexColors: true,
          transparent: true,
          opacity: 0.9,
          sizeAttenuation: true,
          depthWrite: false,
        }));
        Graph.scene().add(stars);
        const drift = () => {
          if (disposedRef.current) return;
          stars.rotation.y += 0.00012;
          stars.rotation.x += 0.00003;
          requestAnimationFrame(drift);
        };
        drift();
      }

      const controls = Graph.controls();
      controls.autoRotate = true;
      controls.autoRotateSpeed = 0.4;
      controls.addEventListener('start', () => {
        controls.autoRotate = false;
        setTimeout(() => {
          if (!selectedRef.current && !disposedRef.current) controls.autoRotate = true;
        }, 10_000);
      });

      let framed = false;
      const frameOnce = () => {
        if (framed || cancelled) return;
        framed = true;
        frameGalaxy();
      };
      Graph.onEngineStop(frameOnce);
      setTimeout(frameOnce, 4500);
    })().catch((err) => {
      emitError('app', `Galaxy failed to start: ${err instanceof Error ? err.message : err}`);
    });

    const onResize = () => {
      graphRef.current?.width(window.innerWidth).height(window.innerHeight);
    };
    window.addEventListener('resize', onResize);

    return () => {
      cancelled = true;
      disposedRef.current = true;
      window.removeEventListener('resize', onResize);
      document.body.style.cursor = 'default';
      try {
        graphRef.current?._destructor();
      } catch { /* renderer already gone */ }
      graphRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ESC clears the selection (only intervenes while a note is open).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && selectedRef.current) clearSelection();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [clearSelection]);

  return (
    <div className="fixed inset-0 z-[2]">
      <div ref={containerRef} className="absolute inset-0" />

      {/* Top-center wordmark — settings access while the ring HUD is hidden */}
      <button
        type="button"
        onClick={onOpenSettings}
        className="absolute top-5 left-1/2 -translate-x-1/2 z-10 px-4 py-1.5 font-mono text-xs font-bold tracking-[0.35em] text-cyan-400/90 uppercase border border-cyan-500/25 rounded bg-black/60 backdrop-blur-sm hover:border-cyan-400 hover:text-cyan-200 transition-colors"
        title="Open settings"
      >
        J.A.R.V.I.S. — Knowledge Galaxy
      </button>

      {/* Stats + legend */}
      <div className="absolute bottom-24 left-6 z-10 max-w-[240px] rounded border border-cyan-500/25 bg-black/70 backdrop-blur-sm px-3 py-2 font-mono text-[10px] text-cyan-400/90 space-y-1">
        <div className="uppercase tracking-widest text-cyan-500 font-bold">
          {error
            ? 'Scan failed'
            : stats
              ? `${stats.notes} notes · ${stats.links} links`
              : 'Scanning archives…'}
        </div>
        {error && <div className="text-red-400 normal-case">{error}</div>}
        {groups.map((g) => (
          <div key={g.name} className="flex items-center gap-2">
            <span
              className="w-2 h-2 rounded-full flex-none"
              style={{ background: g.color, boxShadow: `0 0 6px ${g.color}` }}
            />
            <span className="truncate">{g.name}</span>
            <span className="ml-auto pl-3 text-cyan-700">{g.count}</span>
          </div>
        ))}
      </div>

      {/* Note panel */}
      {panel && (
        <aside className="absolute top-16 right-5 z-10 flex w-[min(360px,calc(100vw-40px))] max-h-[calc(100vh-160px)] flex-col overflow-hidden rounded-lg border border-cyan-500/30 bg-black/85 backdrop-blur-md shadow-[0_0_24px_rgba(34,211,238,0.15)]">
          <header className="flex items-start gap-2 border-b border-cyan-500/20 px-4 py-3">
            <div className="min-w-0 flex-1">
              <h2 className="font-mono text-sm font-bold tracking-wide text-cyan-200 break-words">
                {panel.node.label}
              </h2>
              <span
                className="mt-1.5 inline-block rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-widest"
                style={{ color: panel.color, borderColor: panel.color }}
              >
                {panel.node.group}
              </span>
              <div className="mt-1 font-mono text-[9px] text-cyan-800 break-all">{panel.node.path}</div>
            </div>
            <button
              type="button"
              onClick={clearSelection}
              className="p-1 text-cyan-600 hover:text-white"
              aria-label="Close note"
            >
              ✕
            </button>
          </header>
          <div className="overflow-y-auto px-4 py-3">
            <p className="select-text whitespace-pre-wrap font-mono text-[11.5px] leading-relaxed text-cyan-50/90">
              {panel.node.excerpt || '(empty note)'}
            </p>
            <div className="mt-4 mb-1 font-mono text-[9px] uppercase tracking-[0.2em] text-cyan-600">
              {panel.neighbors.length ? `Linked notes — ${panel.neighbors.length}` : 'No linked notes'}
            </div>
            {panel.neighbors.map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => {
                  const node = nodesRef.current[n.id]; // id === index
                  if (node) selectNode(node);
                }}
                className="flex w-full items-center gap-2 rounded px-1 py-1 text-left font-mono text-[11px] text-cyan-300 hover:bg-cyan-500/10"
              >
                <span
                  className="h-1.5 w-1.5 flex-none rounded-full"
                  style={{ background: n.color, boxShadow: `0 0 5px ${n.color}` }}
                />
                <span className="truncate">{n.label}</span>
              </button>
            ))}
          </div>
        </aside>
      )}
    </div>
  );
}

export default GalaxyScreen;
