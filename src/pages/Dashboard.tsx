// Dashboard — twin runtime cards + bento overview.

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BentoCard } from '@/components/ui/BentoCard';
import { StatTile } from '@/components/ui/StatTile';
import { Glyph, type IconName } from '@/components/ui/Icon';
import { Sparkline, Ring } from '@/components/ui/Charts';
import { RuntimeBadge } from '@/components/ui/Runtime';
import { LaunchCard } from '@/components/ui/LaunchCard';
import { useAppStore } from '@/store/appStore';
import { ACCENTS, useThemeStore } from '@/store/themeStore';
import { useImages, useNetworks, useRuntimes, useVolumes } from '@/hooks/useData';
import { ContainerCommands, RuntimeCommands } from '@/lib/commands';
import { ACTIVITY, CPU_SPARK, MEM_SPARK } from '@/data/seed';
import type {
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

const STACK_ICONS: Record<string, IconName> = {
  database: 'volume',
  cache: 'bolt',
  service: 'container',
  storage: 'disk',
  'dev-tool': 'build',
  observability: 'cpu',
};

function RunningStackCard({ containers, query }: { containers: Container[]; query: string }) {
  const toggleRunPause = useAppStore((s) => s.toggleRunPause);
  const refresh = useAppStore((s) => s.refresh);
  const runtimeFilter = useAppStore((s) => s.runtimeFilter);
  const navigate = useNavigate();
  const [launching, setLaunching] = useState<RuntimeName | null>(null);
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
    ContainerCommands.run(rt, {
      image: 'docker.io/library/hello-world',
      ports: [],
      env: [],
      volumes: [],
      detach: true,
    })
      .then(() => refresh())
      .catch(() => undefined)
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
            {(runtimeFilter === 'all'
              ? (['docker', 'podman'] as RuntimeName[])
              : [runtimeFilter]
            ).map((rt) => (
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
            onClick={() => toggleRunPause(c.id)}
          >
            <span
              className="pb-icon s-ok"
              style={{ background: RUNTIME_SOFT[c.rt], color: RUNTIME_ACCENT[c.rt] }}
            >
              <Glyph name={STACK_ICONS[c.tag] || 'container'} size={13} />
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

const KIND_LABEL: Record<string, string> = {
  start: 'STARTED',
  stop: 'STOPPED',
  pull: 'PULLED',
  build: 'BUILT',
  prune: 'PRUNED',
  fallback: 'FELL BACK',
};
const KIND_TONE: Record<string, string> = {
  start: 'ok',
  stop: 'dim',
  pull: 'info',
  build: 'info',
  prune: 'warn',
  fallback: 'warn',
};

function ActivityCard() {
  return (
    <BentoCard section="History" sectionIcon="bolt" title="Activity" span={4} headerAlign="left">
      <div className="act-list">
        {ACTIVITY.slice(0, 4).map((a, i) => (
          <div key={i} className="act-card">
            <div className="act-head">
              <span className={`act-tag tone-${KIND_TONE[a.kind]}`}>
                {KIND_LABEL[a.kind]}
              </span>
              <div className="act-head-r">
                <RuntimeBadge rt={a.rt} size="xs" />
                <span className="act-time mono">{a.t}</span>
              </div>
            </div>
            <div className="act-target">{a.target}</div>
            <div className="act-note mono">{a.note}</div>
          </div>
        ))}
      </div>
    </BentoCard>
  );
}

// ─── Resources ───────────────────────────────────────────────────────────────

function ResourcesCard({ accent }: { accent: string }) {
  return (
    <BentoCard section="Telemetry" sectionIcon="cpu" title="Resources" span={5} headerAlign="left">
      <div className="res-stack">
        <div className="res-row">
          <div className="res-row-l">
            <div className="bc-section">
              <span>CPU</span>
            </div>
            <div className="res-row-val">26%</div>
            <div className="res-row-sub mono">4 / 12 cores</div>
          </div>
          <Sparkline data={CPU_SPARK} w={150} h={48} accent={accent} />
        </div>
        <div className="res-row">
          <div className="res-row-l">
            <div className="bc-section">
              <span>RAM</span>
            </div>
            <div className="res-row-val">5.7 GB</div>
            <div className="res-row-sub mono">of 16 GB</div>
          </div>
          <Sparkline data={MEM_SPARK} w={150} h={48} accent={accent} />
        </div>
        <div className="res-row">
          <div className="res-row-l">
            <div className="bc-section">
              <span>DISK</span>
            </div>
            <div className="res-row-val">24.3 GB</div>
            <div className="res-row-sub mono">12% used · 178 GB free</div>
          </div>
          <Ring pct={12} accent={accent} size={64} />
        </div>
      </div>
    </BentoCard>
  );
}

// ─── Quick commands ──────────────────────────────────────────────────────────

function QuickCommandsCard() {
  const navigate = useNavigate();
  const startAllStopped = useAppStore((s) => s.startAllStopped);
  const restartAllRunning = useAppStore((s) => s.restartAllRunning);

  const steps: { icon: IconName; label: string; sub: string; action: () => void }[] = [
    { icon: 'bolt', label: 'Start all', sub: 'Resume paused + stopped', action: () => void startAllStopped() },
    { icon: 'arrow', label: 'Pull image', sub: 'From any registry', action: () => navigate('/images') },
    { icon: 'restart', label: 'Restart all', sub: 'Graceful · keep volumes', action: () => void restartAllRunning() },
    { icon: 'trash', label: 'Prune unused', sub: 'Reclaim 1.2 GB estimated', action: () => navigate('/volumes') },
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
      <div className="pill-grid">
        {volumes.slice(0, 6).map((v) => (
          <button key={v.name} className="pill-btn pill-btn-rt" type="button">
            <span
              className="pb-icon"
              style={{ background: RUNTIME_SOFT[v.rt], color: RUNTIME_ACCENT[v.rt] }}
            >
              <Glyph name="volume" size={13} />
            </span>
            <span className="pb-text">
              <span className="pb-label">{v.name}</span>
              <span className="pb-sub mono">{v.size}</span>
            </span>
          </button>
        ))}
      </div>
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
          <div key={n.name} className="net-pill">
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
            <span className="net-count mono">{n.attached}</span>
          </div>
        ))}
      </div>
    </BentoCard>
  );
}

// ─── Health ──────────────────────────────────────────────────────────────────

function HealthCard({ runtimes }: { runtimes: Record<RuntimeName, RuntimeMeta> }) {
  const found = (['docker', 'podman'] as RuntimeName[]).filter((r) => runtimes[r].found);
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
      <div className="health-title">
        {found.length === 2 ? 'Both runtimes healthy' : `${found.length} runtime active`}
      </div>
      <div className="health-sub mono">
        docker {runtimes.docker.version} · podman {runtimes.podman.version} · auto-fallback on
      </div>
      <button className="health-cta" type="button">
        View report <Glyph name="arrow" size={12} />
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
  const { runtimes, refetch: refetchRuntimes } = useRuntimes();

  const images = useImages('all').data;
  const volumes = useVolumes('all').data;
  const networks = useNetworks('all').data;

  const byFilter = <T extends { rt: RuntimeName }>(arr: T[]): T[] =>
    runtimeFilter === 'all' ? arr : arr.filter((x) => x.rt === runtimeFilter);

  const containers =
    runtimeFilter === 'all'
      ? allContainers
      : allContainers.filter((c) => c.rt === runtimeFilter);

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
        <StatTile value={counts.images} label="Images cached" section="Cached" sectionIcon="image" tone="default" onClick={() => navigate('/images')} />
        <StatTile value={counts.volumes} label="Volumes" section="Storage" sectionIcon="volume" tone="default" onClick={() => navigate('/volumes')} />
        <StatTile value={counts.networks} label="Networks" section="Connectivity" sectionIcon="network" tone="default" onClick={() => navigate('/networks')} />
      </div>

      <RuntimeCard rt="docker" meta={runtimes.docker} containers={allContainers} images={images} volumes={volumes} isActive={runtimeFilter === 'docker'} setRuntimeFilter={setRuntimeFilter} onRefresh={refetchRuntimes} />
      <RuntimeCard rt="podman" meta={runtimes.podman} containers={allContainers} images={images} volumes={volumes} isActive={runtimeFilter === 'podman'} setRuntimeFilter={setRuntimeFilter} onRefresh={refetchRuntimes} />

      <RunningStackCard containers={containers} query={query} />
      <ActivityCard />
      <QuickCommandsCard />

      <ResourcesCard accent={accent} />
      <ImagesGalleryCard images={byFilter(images)} />
      <NetworksCard networks={byFilter(networks)} />

      <VolumesPreviewCard volumes={byFilter(volumes)} />
      <HealthCard runtimes={runtimes} />

      <footer className="ftr">
        <span className="mono">
          dockman 0.1 · docker {runtimes.docker.version} · podman {runtimes.podman.version}
        </span>
        <span className="mono">⌘K · open command palette</span>
      </footer>
    </div>
  );
}
