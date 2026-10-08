// Dashboard — twin runtime cards + bento overview. Every number here is read
// from the engines: counts from the inventories, resources from `stats` and
// `info`, disk from `system df`, the activity feed from what Dockman did.

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BentoCard } from '@/components/ui/BentoCard';
import { StatTile } from '@/components/ui/StatTile';
import { Glyph, type IconName } from '@/components/ui/Icon';
import { Sparkline, Ring } from '@/components/ui/Charts';
import { RuntimeBadge } from '@/components/ui/Runtime';
import { LaunchCard } from '@/components/ui/LaunchCard';
import { useAppStore, type ResourceSample } from '@/store/appStore';
import { ACCENTS, useThemeStore } from '@/store/themeStore';
import { formatClock, useActivityStore } from '@/store/activityStore';
import { logActivity } from '@/store/activityStore';
import {
  useEngineInfo,
  useHostInfo,
  useImages,
  useNetworks,
  useRuntimes,
  useSystemDf,
  useVolumes,
} from '@/hooks/useData';
import { ContainerCommands, RuntimeCommands, SystemCommands, runtimesFor } from '@/lib/commands';
import { formatBytes } from '@/lib/parsers';
import type {
  ActivityKind,
  Container,
  ImageItem,
  Network,
  RuntimeFilter,
  RuntimeMeta,
  RuntimeName,
  Volume,
} from '@/types';

// ─── Twin runtime cards ──────────────────────────────────────────────────────

function RuntimeCard({
  rt,
  meta,
  containers,
  images,
  volumes,
  isActive,
  setRuntimeFilter,
  onRefresh,
}: {
  rt: RuntimeName;
  meta: RuntimeMeta;
  containers: Container[];
  images: ImageItem[];
  volumes: Volume[];
  isActive: boolean;
  setRuntimeFilter: (f: RuntimeFilter) => void;
  onRefresh: () => void;
}) {
  const navigate = useNavigate();
  const refresh = useAppStore((s) => s.refresh);
  const [starting, setStarting] = useState(false);
  const [startErr, setStartErr] = useState<string | null>(null);
  const own = containers.filter((c) => c.rt === rt);
  const running = own.filter((c) => c.status === 'running').length;

  // Once detection reports the engine is up, leave the starting state.
  useEffect(() => {
    if (meta.running) setStarting(false);
  }, [meta.running]);

  const startEngine = async () => {
    setStarting(true);
    setStartErr(null);
    try {
      await RuntimeCommands.startDaemon(rt);
      logActivity('start', rt, `${meta.name} engine`, 'started from the dashboard');
    } catch (e) {
      setStartErr(String(e));
      setStarting(false);
      return;
    }
    // The engine can take a while to become reachable — re-detect repeatedly.
    [2000, 6000, 12000, 22000].forEach((d) =>
      window.setTimeout(() => {
        onRefresh();
        refresh();
      }, d),
    );
    window.setTimeout(() => setStarting(false), 24000);
  };

  if (!meta.found) {
    return (
      <BentoCard span={6} className={`bc-runtime rt-empty rt-card-${rt}`}>
        <div className="rt-empty-icon">
          <Glyph name="extension" size={28} />
        </div>
        <div className="rt-empty-name">{meta.name}</div>
        <div className="rt-empty-sub">Not installed</div>
        <button className="rt-empty-cta" type="button" onClick={() => navigate('/binaries')}>
          Set up <Glyph name="arrow" size={12} />
        </button>
      </BentoCard>
    );
  }

  return (
    <BentoCard
      span={6}
      className={`bc-runtime rt-card rt-card-${rt} ${isActive ? 'is-active' : ''}`}
    >
      <div className="rt-card-h">
        <div className={`rt-card-mark rt-${rt}`}>
          <Glyph name={rt === 'docker' ? 'container' : 'extension'} size={22} />
        </div>
        <div className="rt-card-id">
          <div className="rt-card-name">{meta.name}</div>
          <div
            className="rt-card-status"
            title={startErr ?? undefined}
            style={startErr ? { color: 'var(--bad)' } : undefined}
          >
            <span
              className="ok-dot"
              style={{
                background: startErr
                  ? 'var(--bad)'
                  : meta.running
                    ? meta.accent
                    : 'var(--dim)',
                boxShadow: meta.running ? `0 0 0 4px ${meta.soft}` : 'none',
              }}
            />
            {startErr
              ? startErr
              : starting
                ? 'starting engine…'
                : `engine ${meta.running ? 'running' : 'idle'} · v${meta.version}`}
          </div>
        </div>
        {meta.running ? (
          <button
            className={`rt-card-toggle ${isActive ? 'is-on' : ''}`}
            type="button"
            onClick={() => setRuntimeFilter(isActive ? 'all' : rt)}
          >
            {isActive ? 'filtered' : 'filter'}
          </button>
        ) : (
          <button
            className="rt-card-toggle"
            type="button"
            onClick={startEngine}
            disabled={starting}
            style={{ background: 'var(--accent)', color: 'var(--bg)' }}
          >
            {starting ? 'starting…' : 'start engine'}
          </button>
        )}
      </div>

      <div className="rt-card-meta mono">
        <span className="rt-pill">{meta.arch}</span>
        <span className="rt-pill rt-pill-path">{meta.path}</span>
      </div>

      <div className="rt-card-stats">
        <div className="rt-stat">
          <div className="rt-stat-val">{running}</div>
          <div className="rt-stat-l">running</div>
        </div>
        <div className="rt-stat">
          <div className="rt-stat-val">{own.length}</div>
          <div className="rt-stat-l">total</div>
        </div>
        <div className="rt-stat">
          <div className="rt-stat-val">{images.filter((i) => i.rt === rt).length}</div>
          <div className="rt-stat-l">images</div>
        </div>
        <div className="rt-stat">
          <div className="rt-stat-val">{volumes.filter((v) => v.rt === rt).length}</div>
          <div className="rt-stat-l">volumes</div>
        </div>
      </div>
    </BentoCard>
  );
}

// ─── Active stack ────────────────────────────────────────────────────────────

function RunningStackCard({ containers, query }: { containers: Container[]; query: string }) {
  const toggleRunPause = useAppStore((s) => s.toggleRunPause);
  const refresh = useAppStore((s) => s.refresh);
  const runtimeFilter = useAppStore((s) => s.runtimeFilter);
  const navigate = useNavigate();
  const [launching, setLaunching] = useState<RuntimeName | null>(null);
  const [launchErr, setLaunchErr] = useState<string | null>(null);
  const filtered = containers
    .filter((c) => c.status !== 'stopped')
    .filter(
      (c) =>
        !query ||
        c.name.toLowerCase().includes(query.toLowerCase()) ||
        c.image.toLowerCase().includes(query.toLowerCase()),
    );

  // Run the canonical hello-world image — a quick "does my runtime work" check.
  const runHello = (rt: RuntimeName) => {
    setLaunching(rt);
    setLaunchErr(null);
    ContainerCommands.run(rt, {
      image: 'docker.io/library/hello-world',
      ports: [],
      env: [],
      volumes: [],
      command: [],
      detach: true,
    })
      .then(() => {
        logActivity('run', rt, 'hello-world', 'runtime check');
        return refresh();
      })
      .catch((e) => {
        setLaunchErr(String(e));
        logActivity('error', rt, 'hello-world', String(e));
      })
      .finally(() => setLaunching(null));
  };

  if (containers.length === 0) {
    return (
      <BentoCard section="Live" sectionIcon="bolt" title="Active Stack" span={4}>
        {launching ? (
          <LaunchCard rt={launching} />
        ) : (
          <div className="empty" style={{ padding: '24px 8px' }}>
            <Glyph name="container" size={22} />
            <div>No containers yet — run a test image to check things work.</div>
            <div
              style={{
                display: 'flex',
                gap: 6,
                flexWrap: 'wrap',
                justifyContent: 'center',
              }}
            >
              {runtimesFor(runtimeFilter).map((rt) => (
                <button
                  key={rt}
                  className="action-btn"
                  type="button"
                  onClick={() => runHello(rt)}
                >
                  <Glyph name="play" size={12} /> hello-world · {rt}
                </button>
              ))}
            </div>
            {launchErr && <div className="rcm-error mono">{launchErr}</div>}
          </div>
        )}
      </BentoCard>
    );
  }

  return (
    <BentoCard section="Live" sectionIcon="bolt" title="Active Stack" span={4}>
      <div className="pill-grid">
        {filtered.slice(0, 8).map((c) => (
          <button
            key={c.id}
            className="pill-btn pill-btn-rt"
            type="button"
            title={c.status === 'running' ? 'Pause' : 'Resume'}
            onClick={() => toggleRunPause(c.id)}
          >
            <span
              className="pb-icon s-ok"
              style={{ background: RUNTIME_SOFT[c.rt], color: RUNTIME_ACCENT[c.rt] }}
            >
              <Glyph name={c.status === 'paused' ? 'pause' : 'container'} size={13} />
            </span>
            <span className="pb-text">
              <span className="pb-label">{c.name}</span>
              <span className="pb-sub mono">
                {c.cpu.toFixed(1)}% · {c.rt}
              </span>
            </span>
          </button>
        ))}
      </div>
      <div className="bc-foot">
        <span className="mono">
          {filtered.length} of {containers.length}
        </span>
        <button className="text-btn" type="button" onClick={() => navigate('/containers')}>
          View all →
        </button>
      </div>
    </BentoCard>
  );
}

// ─── Activity ────────────────────────────────────────────────────────────────

const KIND_LABEL: Record<ActivityKind, string> = {
  start: 'STARTED',
  stop: 'STOPPED',
  pause: 'PAUSED',
  restart: 'RESTARTED',
  remove: 'REMOVED',
  run: 'RAN',
  pull: 'PULLED',
  build: 'BUILT',
  prune: 'PRUNED',
  fallback: 'FELL BACK',
  install: 'INSTALLED',
  error: 'FAILED',
};
const KIND_TONE: Record<ActivityKind, string> = {
  start: 'ok',
  stop: 'dim',
  pause: 'dim',
  restart: 'info',
  remove: 'warn',
  run: 'ok',
  pull: 'info',
  build: 'info',
  prune: 'warn',
  fallback: 'warn',
  install: 'ok',
  error: 'bad',
};

function ActivityCard({ filter }: { filter: RuntimeFilter }) {
  const entries = useActivityStore((s) => s.entries);
  const clear = useActivityStore((s) => s.clear);
  const shown = entries.filter((a) => filter === 'all' || a.rt === filter).slice(0, 5);
  return (
    <BentoCard
      section="History"
      sectionIcon="bolt"
      title="Activity"
      span={4}
      headerAlign="left"
      headerAside={
        entries.length > 0 ? (
          <button className="text-btn" type="button" onClick={clear}>
            Clear
          </button>
        ) : undefined
      }
    >
      {shown.length === 0 ? (
        <div className="empty" style={{ padding: '20px 8px' }}>
          <Glyph name="bolt" size={20} />
          <div>Actions you take in Dockman show up here.</div>
        </div>
      ) : (
        <div className="act-list">
          {shown.map((a) => (
            <div key={a.at + a.target} className="act-card">
              <div className="act-head">
                <span className={`act-tag tone-${KIND_TONE[a.kind]}`}>
                  {KIND_LABEL[a.kind]}
                </span>
                <div className="act-head-r">
                  <RuntimeBadge rt={a.rt} size="xs" />
                  <span className="act-time mono">{formatClock(a.at)}</span>
                </div>
              </div>
              <div className="act-target">{a.target}</div>
              {a.note && <div className="act-note mono">{a.note}</div>}
            </div>
          ))}
        </div>
      )}
    </BentoCard>
  );
}

// ─── Resources ───────────────────────────────────────────────────────────────

/** Sparkline needs two points; pad a short history by repeating its first. */
function series(history: ResourceSample[], pick: (s: ResourceSample) => number): number[] {
  const vals = history.map(pick);
  if (vals.length === 0) return [0, 0];
  if (vals.length === 1) return [vals[0], vals[0]];
  return vals;
}

function ResourcesCard({ accent, filter }: { accent: string; filter: RuntimeFilter }) {
  const history = useAppStore((s) => s.history);
  const engines = useEngineInfo(filter, 30000).data;
  const df = useSystemDf(filter, 30000).data;
  const latest = history[history.length - 1];

  // Engines on one machine share its CPUs and memory, so take the largest.
  const ncpu = Math.max(0, ...engines.map((e) => e.ncpu));
  const memTotal = Math.max(0, ...engines.map((e) => e.memTotal));
  const cpuCores = latest ? latest.cpu / 100 : 0;
  const cpuPct = ncpu > 0 ? Math.min(100, (cpuCores / ncpu) * 100) : 0;
  const memMB = latest?.mem ?? 0;
  const memPct = memTotal > 0 ? Math.min(100, (memMB * 1024 * 1024 * 100) / memTotal) : 0;
  const diskUsed = df.reduce((s, r) => s + r.sizeBytes, 0);
  const diskReclaim = df.reduce((s, r) => s + r.reclaimableBytes, 0);
  const diskPct = diskUsed > 0 ? Math.round((diskReclaim / diskUsed) * 100) : 0;

  return (
    <BentoCard section="Telemetry" sectionIcon="cpu" title="Resources" span={5} headerAlign="left">
      <div className="res-stack">
        <div className="res-row">
          <div className="res-row-l">
            <div className="bc-section">
              <span>CPU</span>
            </div>
            <div className="res-row-val">{engines.length ? `${Math.round(cpuPct)}%` : '—'}</div>
            <div className="res-row-sub mono">
              {ncpu > 0 ? `${cpuCores.toFixed(2)} of ${ncpu} cores in use` : 'engine not reachable'}
            </div>
          </div>
          <Sparkline data={series(history, (s) => s.cpu)} w={150} h={48} accent={accent} />
        </div>
        <div className="res-row">
          <div className="res-row-l">
            <div className="bc-section">
              <span>RAM</span>
            </div>
            <div className="res-row-val">{formatBytes(memMB * 1024 * 1024)}</div>
            <div className="res-row-sub mono">
              {memTotal > 0
                ? `${memPct.toFixed(1)}% of ${formatBytes(memTotal)} by containers`
                : 'engine not reachable'}
            </div>
          </div>
          <Sparkline data={series(history, (s) => s.mem)} w={150} h={48} accent={accent} />
        </div>
        <div className="res-row">
          <div className="res-row-l">
            <div className="bc-section">
              <span>DISK</span>
            </div>
            <div className="res-row-val">{df.length ? formatBytes(diskUsed) : '—'}</div>
            <div className="res-row-sub mono">
              {df.length
                ? `images, containers, volumes · ${formatBytes(diskReclaim)} reclaimable`
                : 'engine not reachable'}
            </div>
          </div>
          <Ring pct={diskPct} accent={accent} size={64} />
        </div>
      </div>
    </BentoCard>
  );
}

// ─── Quick commands ──────────────────────────────────────────────────────────

function QuickCommandsCard({ filter }: { filter: RuntimeFilter }) {
  const navigate = useNavigate();
  const startAllStopped = useAppStore((s) => s.startAllStopped);
  const restartAllRunning = useAppStore((s) => s.restartAllRunning);
  const refresh = useAppStore((s) => s.refresh);
  const df = useSystemDf(filter, 30000);
  const [pruning, setPruning] = useState(false);
  const [pruneMsg, setPruneMsg] = useState<string | null>(null);
  const reclaimable = df.data.reduce((s, r) => s + r.reclaimableBytes, 0);

  const prune = async () => {
    if (pruning) return;
    setPruning(true);
    setPruneMsg(null);
    for (const rt of runtimesFor(filter)) {
      try {
        const out = await SystemCommands.prune(rt);
        const line = out.split('\n').find((l) => l.toLowerCase().includes('reclaimed')) ?? '';
        logActivity('prune', rt, 'system', line.trim() || 'system prune');
        setPruneMsg(`${rt}: ${line.trim() || 'done'}`);
      } catch (e) {
        setPruneMsg(`${rt}: ${String(e)}`);
        logActivity('error', rt, 'system prune', String(e));
      }
    }
    setPruning(false);
    df.refetch();
    refresh();
  };

  const steps: { icon: IconName; label: string; sub: string; action: () => void }[] = [
    { icon: 'bolt', label: 'Start all', sub: 'Resume paused and stopped containers', action: () => void startAllStopped() },
    { icon: 'arrow', label: 'Pull image', sub: 'From any registry', action: () => navigate('/images') },
    { icon: 'restart', label: 'Restart all', sub: 'Every running container', action: () => void restartAllRunning() },
    {
      icon: 'trash',
      label: pruning ? 'Pruning…' : 'Prune unused',
      sub: df.data.length
        ? `${formatBytes(reclaimable)} reclaimable · stopped containers, dangling images, build cache`
        : 'stopped containers, dangling images, build cache',
      action: () => void prune(),
    },
    { icon: 'extension', label: 'Open binary manager', sub: 'Add or update Docker / Podman', action: () => navigate('/binaries') },
  ];

  return (
    <BentoCard section="Workflow" sectionIcon="bolt" title="Quick Commands" span={4} headerAlign="left">
      <div className="work-list">
        {steps.map((s) => (
          <button key={s.label} className="work-row" type="button" onClick={s.action}>
            <span className="work-icon">
              <Glyph name={s.icon} size={14} />
            </span>
            <span className="work-text">
              <span className="work-label">{s.label}</span>
              <span className="work-sub">{s.sub}</span>
            </span>
            <Glyph name="arrow" size={12} />
          </button>
        ))}
      </div>
      {pruneMsg && <div className="rcm-note mono">{pruneMsg}</div>}
    </BentoCard>
  );
}

// ─── Recent images ───────────────────────────────────────────────────────────

function ImagesGalleryCard({ images }: { images: ImageItem[] }) {
  const navigate = useNavigate();
  return (
    <BentoCard
      section="Registry"
      sectionIcon="image"
      title="Images"
      span={4}
      headerAlign="left"
      headerAside={
        <button className="text-btn" type="button" onClick={() => navigate('/images')}>
          Browse →
        </button>
      }
    >
      {images.length === 0 ? (
        <div className="empty" style={{ padding: '20px 8px' }}>
          <Glyph name="image" size={20} />
          <div>No images yet.</div>
        </div>
      ) : (
        <div className="img-stack">
          {images.slice(0, 4).map((img, i) => (
            <div key={img.id + img.tag} className="img-tile">
              <div className={`img-thumb thumb-${i % 4}`}>
                <span className="thumb-id mono">
                  {(img.name.split('/').pop() || '?')[0].toUpperCase()}
                </span>
              </div>
              <div className="img-info">
                <div className="img-name mono">
                  {img.name}:<b>{img.tag}</b>
                </div>
                <div className="img-sub mono">
                  {img.size} · {img.built}
                </div>
              </div>
              <RuntimeBadge rt={img.rt} size="xs" showLabel={false} />
            </div>
          ))}
        </div>
      )}
    </BentoCard>
  );
}

// ─── Volumes preview ─────────────────────────────────────────────────────────

function VolumesPreviewCard({ volumes }: { volumes: Volume[] }) {
  const navigate = useNavigate();
  return (
    <BentoCard
      section="Storage"
      sectionIcon="volume"
      title="Volumes"
      span={6}
      headerAlign="left"
      headerAside={
        <button className="text-btn" type="button" onClick={() => navigate('/volumes')}>
          All →
        </button>
      }
    >
      {volumes.length === 0 ? (
        <div className="empty" style={{ padding: '20px 8px' }}>
          <Glyph name="volume" size={20} />
          <div>No volumes yet.</div>
        </div>
      ) : (
        <div className="pill-grid">
          {volumes.slice(0, 6).map((v) => (
            <button
              key={v.rt + v.name}
              className="pill-btn pill-btn-rt"
              type="button"
              onClick={() => navigate('/volumes')}
            >
              <span
                className="pb-icon"
                style={{ background: RUNTIME_SOFT[v.rt], color: RUNTIME_ACCENT[v.rt] }}
              >
                <Glyph name="volume" size={13} />
              </span>
              <span className="pb-text">
                <span className="pb-label">{v.name}</span>
                <span className="pb-sub mono">{v.driver}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </BentoCard>
  );
}

// ─── Networks ────────────────────────────────────────────────────────────────

function NetworksCard({ networks }: { networks: Network[] }) {
  return (
    <BentoCard
      section="Connectivity"
      sectionIcon="network"
      title="Networks"
      span={3}
      headerAlign="left"
    >
      <div className="net-rows">
        {networks.slice(0, 4).map((n) => (
          <div key={n.rt + n.name} className="net-pill">
            <span
              className="net-icon"
              style={{ background: RUNTIME_SOFT[n.rt], color: RUNTIME_ACCENT[n.rt] }}
            >
              <Glyph name="network" size={12} />
            </span>
            <span className="net-meta">
              <span className="net-name">{n.name}</span>
              <span className="net-sub mono">{n.driver}</span>
            </span>
            <span className="net-count mono" title="attached containers">
              {n.attached}
            </span>
          </div>
        ))}
      </div>
    </BentoCard>
  );
}

// ─── Health ──────────────────────────────────────────────────────────────────

function HealthCard({ runtimes }: { runtimes: Record<RuntimeName, RuntimeMeta> }) {
  const navigate = useNavigate();
  const autoFallback = useThemeStore((s) => s.m1Fallback);
  const found = (['docker', 'podman'] as RuntimeName[]).filter((r) => runtimes[r].found);
  const running = found.filter((r) => runtimes[r].running);
  const title =
    found.length === 0
      ? 'No runtime installed'
      : running.length === found.length
        ? found.length === 2
          ? 'Both engines running'
          : `${runtimes[found[0]].name} engine running`
        : `${running.length} of ${found.length} engines running`;
  return (
    <BentoCard span={6} className="bc-health">
      <div className="health-icon">
        <svg
          viewBox="0 0 32 32"
          width="32"
          height="32"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        >
          <path d="M16 3l11 6v8c0 7-4.5 11-11 12C9.5 28 5 24 5 17V9l11-6z" />
          <path d="M11 16l3 3 6-7" />
        </svg>
      </div>
      <div className="health-title">{title}</div>
      <div className="health-sub mono">
        {found.map((r) => `${r} ${runtimes[r].version}`).join(' · ') || 'install one from Binaries'}
        {' · '}auto-fallback {autoFallback ? 'on' : 'off'}
      </div>
      <button className="health-cta" type="button" onClick={() => navigate('/settings')}>
        Engine details <Glyph name="arrow" size={12} />
      </button>
    </BentoCard>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

const RUNTIME_ACCENT: Record<RuntimeName, string> = {
  docker: 'var(--rt-docker)',
  podman: 'var(--rt-podman)',
};
const RUNTIME_SOFT: Record<RuntimeName, string> = {
  docker: 'var(--rt-docker-soft)',
  podman: 'var(--rt-podman-soft)',
};

export default function Dashboard() {
  const navigate = useNavigate();
  const allContainers = useAppStore((s) => s.containers);
  const runtimeFilter = useAppStore((s) => s.runtimeFilter);
  const setRuntimeFilter = useAppStore((s) => s.setRuntimeFilter);
  const query = useAppStore((s) => s.query);
  const accent = ACCENTS[useThemeStore((s) => s.accent)].hex;
  const { runtimes, refetch: refetchRuntimes } = useRuntimes(15000);
  const host = useHostInfo().data;

  const images = useImages('all').data;
  const volumes = useVolumes('all').data;
  const rawNetworks = useNetworks('all').data;

  const byFilter = <T extends { rt: RuntimeName }>(arr: T[]): T[] =>
    runtimeFilter === 'all' ? arr : arr.filter((x) => x.rt === runtimeFilter);

  const containers =
    runtimeFilter === 'all'
      ? allContainers
      : allContainers.filter((c) => c.rt === runtimeFilter);

  // Attachment counts come from the container inventory's network lists.
  const networks = rawNetworks.map((n) => ({
    ...n,
    attached: allContainers.filter((c) => c.rt === n.rt && c.networks.includes(n.name)).length,
  }));

  const counts = {
    running: containers.filter((c) => c.status === 'running').length,
    images: byFilter(images).length,
    volumes: byFilter(volumes).length,
    networks: byFilter(networks).length,
  };

  return (
    <div className="bento">
      <div className="stat-strip" style={{ gridColumn: 'span 12' }}>
        <StatTile value={counts.running} label="Containers running" section="Live" sectionIcon="bolt" tone="violet" onClick={() => navigate('/containers')} />
        <StatTile value={counts.images} label="Images" section="Local" sectionIcon="image" tone="default" onClick={() => navigate('/images')} />
        <StatTile value={counts.volumes} label="Volumes" section="Storage" sectionIcon="volume" tone="default" onClick={() => navigate('/volumes')} />
        <StatTile value={counts.networks} label="Networks" section="Connectivity" sectionIcon="network" tone="default" onClick={() => navigate('/networks')} />
      </div>

      <RuntimeCard rt="docker" meta={runtimes.docker} containers={allContainers} images={images} volumes={volumes} isActive={runtimeFilter === 'docker'} setRuntimeFilter={setRuntimeFilter} onRefresh={refetchRuntimes} />
      <RuntimeCard rt="podman" meta={runtimes.podman} containers={allContainers} images={images} volumes={volumes} isActive={runtimeFilter === 'podman'} setRuntimeFilter={setRuntimeFilter} onRefresh={refetchRuntimes} />

      <RunningStackCard containers={containers} query={query} />
      <ActivityCard filter={runtimeFilter} />
      <QuickCommandsCard filter={runtimeFilter} />

      <ResourcesCard accent={accent} filter={runtimeFilter} />
      <ImagesGalleryCard images={byFilter(images)} />
      <NetworksCard networks={byFilter(networks)} />

      <VolumesPreviewCard volumes={byFilter(volumes)} />
      <HealthCard runtimes={runtimes} />

      <footer className="ftr">
        <span className="mono">
          dockman {host?.appVersion ?? ''} · docker {runtimes.docker.version || '—'} · podman{' '}
          {runtimes.podman.version || '—'}
        </span>
        <span className="mono">⌘K · search</span>
      </footer>
    </div>
  );
}
