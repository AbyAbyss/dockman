// Overview — the console dashboard. Replaces the oversized stat tiles with a
// thin health strip, then engine cards, host resources, compose stack cards
// and the activity / quick-command pair.

import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Glyph, type IconName } from '@/components/ui/Icon';
import { useAppStore } from '@/store/appStore';
import { useCounts } from '@/hooks/useCounts';
import { useHostResources, HOST } from '@/hooks/useHostResources';
import { useImages, useRuntimes, useVolumes } from '@/hooks/useData';
import { ACTIVITY, CPU_SPARK, MEM_SPARK } from '@/data/seed';
import type { ActivityKind, Container, RuntimeName } from '@/types';

/** Bar sparkline — heights are a percentage of the series max, floor 6%. */
function Spark({
  series,
  tone = 'accent',
  height = 30,
}: {
  series: number[];
  tone?: 'accent' | 'accent-soft' | 'warn';
  height?: number;
}) {
  const max = Math.max(1, ...series);
  return (
    <div className="spark" style={{ height }}>
      {series.map((v, i) => (
        <div
          key={i}
          className={`spark-bar tone-${tone}`}
          style={{ height: `${Math.max(6, (v / max) * 100)}%` }}
        />
      ))}
    </div>
  );
}

const KIND_LABEL: Record<ActivityKind, string> = {
  start: 'STARTED',
  stop: 'STOPPED',
  pull: 'PULLED',
  build: 'BUILT',
  prune: 'PRUNED',
  fallback: 'FALLBACK',
};

const KIND_TONE: Record<ActivityKind, string> = {
  start: 'ok',
  stop: 'dim',
  pull: 'info',
  build: 'ok',
  prune: 'bad',
  fallback: 'warn',
};

export default function Dashboard() {
  const navigate = useNavigate();
  const containers = useAppStore((s) => s.containers);
  const runtimeFilter = useAppStore((s) => s.runtimeFilter);
  const setFocusedContainer = useAppStore((s) => s.setFocusedContainer);
  const startAllStopped = useAppStore((s) => s.startAllStopped);
  const stopAllRunning = useAppStore((s) => s.stopAllRunning);
  const restartAllRunning = useAppStore((s) => s.restartAllRunning);
  const startStack = useAppStore((s) => s.startStack);
  const stopStack = useAppStore((s) => s.stopStack);
  const restartStack = useAppStore((s) => s.restartStack);

  const counts = useCounts();
  const res = useHostResources();
  const { runtimes } = useRuntimes();
  const images = useImages(runtimeFilter).data;
  const volumes = useVolumes(runtimeFilter).data;

  const visible = useMemo(
    () =>
      runtimeFilter === 'all'
        ? containers
        : containers.filter((c) => c.rt === runtimeFilter),
    [containers, runtimeFilter],
  );

  const stacks = useMemo(() => {
    const map = new Map<string, Container[]>();
    visible.forEach((c) => {
      const list = map.get(c.stack);
      if (list) list.push(c);
      else map.set(c.stack, [c]);
    });
    return Array.from(map.entries())
      .map(([name, items]) => ({ name, items }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [visible]);

  const strip = [
    {
      k: 'CONTAINERS',
      v: `${counts.running} / ${counts.total}`,
      sub: 'up',
      pct: counts.total ? (counts.running / counts.total) * 100 : 0,
      tone: 'accent' as const,
    },
    {
      k: 'CPU',
      v: `${Math.round(res.cpuPercent)}%`,
      sub: `${res.coresBusy} of ${HOST.cores} cores`,
      pct: res.cpuPercent,
      tone: 'accent' as const,
    },
    {
      k: 'MEMORY',
      v: `${res.memUsedGb.toFixed(1)} GB`,
      sub: `of ${HOST.memTotalGb}`,
      pct: res.memPercent,
      tone: 'accent' as const,
    },
    {
      k: 'DISK',
      v: `${res.diskUsedGb} GB`,
      sub: `${res.diskFreeGb} free`,
      pct: res.diskPercent,
      tone: 'warn' as const,
    },
  ];

  const quick: {
    icon: IconName;
    label: string;
    sub: string;
    tone: 'accent' | 'bad' | 'warn';
    run: () => void;
  }[] = [
    {
      icon: 'play',
      label: 'Start all stopped',
      sub: `${counts.stopped} containers · resume paused too`,
      tone: 'accent',
      run: startAllStopped,
    },
    {
      icon: 'stop',
      label: 'Stop all running',
      sub: `${counts.running} containers · graceful SIGTERM`,
      tone: 'bad',
      run: stopAllRunning,
    },
    {
      icon: 'restart',
      label: 'Restart everything',
      sub: 'keep volumes and networks',
      tone: 'accent',
      run: restartAllRunning,
    },
    {
      icon: 'trash',
      label: 'Prune unused',
      sub: 'reclaim 1.2 GB estimated',
      tone: 'warn',
      run: () => navigate('/volumes'),
    },
    {
      icon: 'extension',
      label: 'Open binary manager',
      sub: 'add or update Docker / Podman',
      tone: 'accent',
      run: () => navigate('/binaries'),
    },
  ];

  // Clicking a container anywhere on this screen focuses it on Containers.
  const openContainer = (c: Container) => {
    setFocusedContainer(c.id);
    navigate('/containers');
  };

  const engineCounts = (rt: RuntimeName) => {
    const own = containers.filter((c) => c.rt === rt);
    return [
      { k: 'RUNNING', v: own.filter((c) => c.status === 'running').length },
      { k: 'TOTAL', v: own.length },
      { k: 'IMAGES', v: images.filter((i) => i.rt === rt).length },
      { k: 'VOLUMES', v: volumes.filter((v) => v.rt === rt).length },
    ];
  };

  return (
    <div className="ov">
      {/* ─── Health strip ──────────────────────────────────────────────── */}
      <div className="card ov-strip">
        {strip.map((s) => (
          <div key={s.k} className="ov-strip-cell">
            <div className="section-label">{s.k}</div>
            <div className="ov-strip-val">
              <span className="ov-strip-n">{s.v}</span>
              <span className="ov-strip-sub mono">{s.sub}</span>
            </div>
            <div className="track">
              <div
                className={`track-fill tone-${s.tone}`}
                style={{ width: `${Math.min(100, Math.max(0, s.pct))}%` }}
              />
            </div>
          </div>
        ))}
        <div className="ov-strip-cell ov-engines">
          <div className="section-label">ENGINES</div>
          {(['docker', 'podman'] as RuntimeName[]).map((rt) => (
            <div key={rt} className="ov-engine-row">
              <span
                className="ov-engine-dot"
                style={{ background: runtimes[rt].accent }}
              />
              <span className="mono">
                {rt} {runtimes[rt].version}
              </span>
              <span className="ov-engine-state mono">
                {runtimes[rt].running ? 'running' : 'stopped'}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* ─── Engines + host resources ──────────────────────────────────── */}
      <div className="ov-row-3">
        {(['docker', 'podman'] as RuntimeName[]).map((rt) => {
          const meta = runtimes[rt];
          return (
            <div key={rt} className="card ov-engine-card">
              <div className="ov-engine-head">
                <span className={`ov-engine-icon rt-${rt}`}>
                  <Glyph name="container" size={16} />
                </span>
                <div className="ov-engine-id">
                  <div className="ov-engine-name">{meta.name}</div>
                  <div className="ov-engine-meta mono">
                    <span
                      className="ov-engine-dot"
                      style={{ background: meta.running ? meta.accent : undefined }}
                    />
                    engine {meta.running ? 'running' : 'stopped'} · v{meta.version}
                  </div>
                </div>
                <span className="chip mono">{meta.arch}</span>
              </div>
              <div className="ov-path mono">{meta.path}</div>
              <div className="ov-engine-counts">
                {engineCounts(rt).map((c) => (
                  <div key={c.k} className="ov-count">
                    <div className="ov-count-v">{c.v}</div>
                    <div className="ov-count-k">{c.k}</div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}

        <div className="card ov-res">
          <div className="card-title">Host resources</div>
          {[
            {
              k: 'CPU',
              v: `${Math.round(res.cpuPercent)}%`,
              sub: `${res.coresBusy} of ${HOST.cores} cores busy`,
              series: CPU_SPARK,
              tone: 'accent' as const,
            },
            {
              k: 'MEMORY',
              v: `${res.memUsedGb.toFixed(1)} GB`,
              sub: `of ${HOST.memTotalGb} GB`,
              series: MEM_SPARK,
              tone: 'accent-soft' as const,
            },
            {
              k: 'DISK',
              v: `${res.diskUsedGb} GB`,
              sub: `${res.diskFreeGb} GB free`,
              series: MEM_SPARK.map((m) => m * 0.4),
              tone: 'warn' as const,
            },
          ].map((b) => (
            <div key={b.k} className="ov-res-block">
              <div className="ov-res-head">
                <span className="section-label">{b.k}</span>
                <span className="ov-res-v">{b.v}</span>
              </div>
              <div className="ov-res-sub mono">{b.sub}</div>
              <Spark series={b.series} tone={b.tone} />
            </div>
          ))}
        </div>
      </div>

      {/* ─── Stack cards ───────────────────────────────────────────────── */}
      <div className="ov-row-3">
        {stacks.length === 0 && (
          <div className="card empty">
            <Glyph name="container" size={24} />
            <div>No compose stacks detected.</div>
          </div>
        )}
        {stacks.map((s) => {
          const up = s.items.filter((c) => c.status === 'running').length;
          const tone = up === s.items.length ? 'ok' : up === 0 ? 'off' : 'part';
          return (
            <div key={s.name} className="card ov-stack">
              <div className="ov-stack-head">
                <span className={`ov-stack-dot tone-${tone}`} />
                <span className="ov-stack-name">{s.name}</span>
                <span className={`ov-stack-chip mono tone-${tone}`}>
                  {up}/{s.items.length} up
                </span>
                <div className="ov-stack-btns">
                  <button
                    type="button"
                    className="icon-btn"
                    title={`Start ${s.name}`}
                    onClick={() => startStack(s.name)}
                  >
                    <Glyph name="play" size={11} fill="currentColor" sw={0} />
                  </button>
                  <button
                    type="button"
                    className="icon-btn is-danger"
                    title={`Stop ${s.name}`}
                    onClick={() => stopStack(s.name)}
                  >
                    <Glyph name="stop" size={11} fill="currentColor" sw={0} />
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    title={`Restart ${s.name}`}
                    onClick={() => restartStack(s.name)}
                  >
                    <Glyph name="restart" size={11} sw={1.8} />
                  </button>
                </div>
              </div>
              <div className="ov-stack-body">
                {s.items.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className="ov-stack-row"
                    onClick={() => openContainer(c)}
                  >
                    <span className={`ov-stack-cdot st-${c.status}`} />
                    <span className="ov-stack-c">
                      <span className="ov-stack-cn">{c.name}</span>
                      <span className="ov-stack-ci mono">{c.image}</span>
                    </span>
                    <span className="ov-stack-stat">
                      <span className="ov-stack-cpu mono">{c.cpu.toFixed(1)}%</span>
                      <span className="ov-stack-mem mono">
                        {c.mem ? `${c.mem} MB` : '—'}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
              <div className="ov-stack-foot">
                <button
                  type="button"
                  className="text-btn"
                  onClick={() => openContainer(s.items[0])}
                >
                  logs
                </button>
                <button
                  type="button"
                  className="text-btn"
                  onClick={() => navigate('/containers')}
                >
                  compose.yml
                </button>
                <span className="ov-stack-net mono">{s.name}_default</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* ─── Activity + quick commands ─────────────────────────────────── */}
      <div className="ov-row-2">
        <div className="card ov-activity">
          <div className="ov-card-head">
            <span className="card-title">Activity</span>
            <button
              type="button"
              className="text-btn"
              onClick={() => navigate('/containers')}
            >
              view all
            </button>
          </div>
          <div className="ov-act-list">
            {ACTIVITY.map((a, i) => (
              <div key={i} className="ov-act-row">
                <span className="ov-act-t mono">{a.t}</span>
                <span className={`ov-act-kind tone-${KIND_TONE[a.kind]}`}>
                  {KIND_LABEL[a.kind]}
                </span>
                <span
                  className="ov-act-rt"
                  style={{ background: runtimes[a.rt].accent }}
                />
                <span className="ov-act-target">{a.target}</span>
                <span className="ov-act-note mono">{a.note}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="card ov-quick">
          <div className="card-title">Quick commands</div>
          {quick.map((q) => (
            <button key={q.label} type="button" className="ov-quick-row" onClick={q.run}>
              <span className={`ov-quick-icon tone-${q.tone}`}>
                <Glyph name={q.icon} size={14} sw={1.6} />
              </span>
              <span className="ov-quick-text">
                <span className="ov-quick-l">{q.label}</span>
                <span className="ov-quick-s mono">{q.sub}</span>
              </span>
              <span className="ov-quick-arrow">
                <Glyph name="arrow" size={13} sw={1.6} />
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
