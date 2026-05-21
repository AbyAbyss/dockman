// Containers — full management view: filterable table with expandable detail
// rows, compose-stack grouping and exec history.

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { BentoCard } from '@/components/ui/BentoCard';
import { StatTile } from '@/components/ui/StatTile';
import { Glyph } from '@/components/ui/Icon';
import { Pill, StatusDot } from '@/components/ui/Badge';
import { RuntimeBadge } from '@/components/ui/Runtime';
import { LaunchCard } from '@/components/ui/LaunchCard';
import { RunContainerModal } from '@/components/ui/RunContainerModal';
import { ComposeLaunchModal } from '@/components/ui/ComposeLaunchModal';
import { ContainerResourcesModal } from '@/components/ui/ContainerResourcesModal';
import { ExecModal } from '@/components/ui/ExecModal';
import { useAppStore } from '@/store/appStore';
import { ContainerCommands, ComposeCommands, containerLogsEvent } from '@/lib/commands';
import { listen, type UnlistenFn } from '@/lib/tauri';
import type { Container, ContainerStatus, RuntimeName } from '@/types';

type StatusFilter = 'all' | ContainerStatus;
type GroupBy = 'flat' | 'stack' | 'image' | 'tag';

const EXEC_HISTORY = [
  { ctr: 'postgres-main', cmd: 'psql -U postgres', when: '4m ago', exit: 0 },
  { ctr: 'api-gateway', cmd: 'sh -c "tail -f /var/log/app.log"', when: '12m ago', exit: 0 },
  { ctr: 'redis-cache', cmd: 'redis-cli MONITOR', when: '1h ago', exit: 130 },
  { ctr: 'nginx-edge', cmd: 'nginx -T', when: '3h ago', exit: 0 },
  { ctr: 'grafana', cmd: 'sh', when: 'yesterday', exit: 0 },
];

/** Live-streaming log view — streams `docker logs --follow` under Tauri,
 *  shows representative sample output in the browser. Primary surface of the
 *  container detail panel: full-width, with line-wrap + follow controls. */
function ContainerLogs({ container }: { container: Container }) {
  const live = useAppStore((s) => s.live);
  const [lines, setLines] = useState<string[]>([]);
  const [wrap, setWrap] = useState(true);
  const [follow, setFollow] = useState(true);
  const bodyRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (!live) return;
    let unlisten: UnlistenFn | undefined;
    let cancelled = false;
    ContainerCommands.startLogs(container.rt, container.id).catch(() => undefined);
    listen<string>(containerLogsEvent(container.id), (l) =>
      setLines((prev) => [...prev.slice(-180), l]),
    ).then((u) => {
      if (cancelled) u();
      else unlisten = u;
    });
    return () => {
      cancelled = true;
      unlisten?.();
      ContainerCommands.stopLogs(container.id).catch(() => undefined);
    };
  }, [live, container.rt, container.id]);

  // While Follow is on, keep the newest line in view as logs stream in.
  useEffect(() => {
    if (follow && bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [lines, follow, live]);

  return (
    <div className="logs-panel">
      <div className="logs-toolbar">
        <div className="det-label">Logs · live</div>
        <div className="logs-toggles">
          <button
            type="button"
            className={`logs-toggle ${wrap ? 'is-on' : ''}`}
            title="Wrap long log lines"
            onClick={() => setWrap((w) => !w)}
          >
            Wrap
          </button>
          <button
            type="button"
            className={`logs-toggle ${follow ? 'is-on' : ''}`}
            title="Auto-scroll to newest line"
            onClick={() => setFollow((f) => !f)}
          >
            Follow
          </button>
        </div>
      </div>
      <pre ref={bodyRef} className={`logs ${wrap ? 'is-wrap' : ''}`}>
        {!live ? (
          <>
            <div>
              [info] starting {container.name} ({container.image})
            </div>
            <div>[info] bound port {container.port}</div>
            <div>[info] health probe OK in 312ms</div>
            <div>[debug] connection pool · 8 idle / 0 in-use</div>
            <div>[info] ready · accepting traffic on {container.port}</div>
          </>
        ) : lines.length === 0 ? (
          <div>streaming logs…</div>
        ) : (
          lines.map((l, i) => <div key={i}>{l}</div>)
        )}
      </pre>
    </div>
  );
}

/** Safely dig into an unknown JSON value by key path. */
function pick(o: unknown, ...keys: string[]): unknown {
  let cur: unknown = o;
  for (const k of keys) {
    if (cur && typeof cur === 'object') cur = (cur as Record<string, unknown>)[k];
    else return undefined;
  }
  return cur;
}

const STATIC_ENV: [string, string][] = [
  ['NODE_ENV', 'production'],
  ['LOG_LEVEL', 'info'],
  ['DATABASE_URL', 'postgres://…'],
];

/** Count containers belonging to a compose service by whole-token name match. */
function replicaCount(items: Container[], service: string): number {
  const esc = service.replace(/[^a-zA-Z0-9]/g, '\\$&');
  const re = new RegExp(`(^|[^a-zA-Z0-9])${esc}([^a-zA-Z0-9]|$)`, 'i');
  return items.filter((c) => re.test(c.name)).length;
}

/** Expanded container detail: live logs, environment, network + exec shell. */
function ContainerDetail({
  container,
  onExec,
}: {
  container: Container;
  onExec: (c: Container) => void;
}) {
  const live = useAppStore((s) => s.live);
  const [env, setEnv] = useState<[string, string][]>([]);
  const [net, setNet] = useState({
    name: 'dockman-backend',
    ip: '172.20.0.4',
    gateway: '172.20.0.1',
  });

  useEffect(() => {
    if (!live) return;
    let cancelled = false;
    ContainerCommands.inspect(container.rt, container.id)
      .then((raw) => {
        if (cancelled) return;
        const d = Array.isArray(raw) ? raw[0] : raw;
        const envVal = pick(d, 'Config', 'Env');
        if (Array.isArray(envVal)) {
          setEnv(
            envVal
              .filter((x): x is string => typeof x === 'string')
              .map((s): [string, string] => {
                const eq = s.indexOf('=');
                return eq > 0 ? [s.slice(0, eq), s.slice(eq + 1)] : [s, ''];
              }),
          );
        }
        const networks = pick(d, 'NetworkSettings', 'Networks');
        if (networks && typeof networks === 'object') {
          const names = Object.keys(networks as Record<string, unknown>);
          if (names.length) {
            const n = (networks as Record<string, unknown>)[names[0]];
            setNet({
              name: names[0],
              ip: String(pick(n, 'IPAddress') ?? '') || '—',
              gateway: String(pick(n, 'Gateway') ?? '') || '—',
            });
          }
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [live, container.rt, container.id]);

  const envRows = live ? env : STATIC_ENV;
  const running = container.status === 'running';

  return (
    <div className="ctr-detail">
      <div className="det-config">
        <div className="det-col">
          <div className="det-label">
            Environment{live && envRows.length ? ` · ${envRows.length}` : ''}
          </div>
          <div className="kv" style={{ maxHeight: 132, overflow: 'auto' }}>
            {envRows.length === 0 && (
              <div>
                <span>{live ? 'no variables' : '—'}</span>
              </div>
            )}
            {envRows.slice(0, 40).map(([k, v], i) => (
              <div key={i}>
                <span>{k}</span>
                <b
                  className="mono"
                  style={{
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    maxWidth: 170,
                  }}
                >
                  {v}
                </b>
              </div>
            ))}
          </div>
        </div>
        <div className="det-col">
          <div className="det-label">Network</div>
          <div className="kv">
            <div>
              <span>Network</span>
              <b>{net.name}</b>
            </div>
            <div>
              <span>IP</span>
              <b className="mono">{net.ip}</b>
            </div>
            <div>
              <span>Gateway</span>
              <b className="mono">{net.gateway}</b>
            </div>
          </div>
          <div className="det-actions">
            <button
              className="action-btn"
              type="button"
              disabled={!running}
              title={running ? undefined : 'Container must be running'}
              onClick={() => onExec(container)}
            >
              <Glyph name="terminal" size={12} /> Open shell
            </button>
          </div>
        </div>
      </div>
      <ContainerLogs container={container} />
    </div>
  );
}

export default function Containers() {
  const allContainers = useAppStore((s) => s.containers);
  const runtimeFilter = useAppStore((s) => s.runtimeFilter);
  const query = useAppStore((s) => s.query);
  const setQuery = useAppStore((s) => s.setQuery);
  const setContainerStatus = useAppStore((s) => s.setContainerStatus);
  const restartContainer = useAppStore((s) => s.restartContainer);
  const removeContainer = useAppStore((s) => s.removeContainer);
  const startAllStopped = useAppStore((s) => s.startAllStopped);
  const startStack = useAppStore((s) => s.startStack);
  const stopStack = useAppStore((s) => s.stopStack);
  const refresh = useAppStore((s) => s.refresh);
  const live = useAppStore((s) => s.live);
  const [launching, setLaunching] = useState<RuntimeName | null>(null);
  const [runOpen, setRunOpen] = useState(false);
  const [execTarget, setExecTarget] = useState<Container | null>(null);
  const [resourceTarget, setResourceTarget] = useState<Container | null>(null);
  const [composeLaunch, setComposeLaunch] = useState<{
    filePath: string;
    runtime?: RuntimeName;
    scale?: string[];
    title?: string;
  } | null>(null);
  const [composeStacks, setComposeStacks] = useState<
    Record<string, { file: string; services: string[]; runtime: RuntimeName }>
  >({});

  const composerRuntime: RuntimeName = runtimeFilter === 'podman' ? 'podman' : 'docker';

  // Map running compose projects → their compose file + service list, so the
  // stacks Dockman knows about gain real compose-backed scaling controls.
  useEffect(() => {
    if (!live) return;
    let cancelled = false;
    (async () => {
      const out: Record<
        string,
        { file: string; services: string[]; runtime: RuntimeName }
      > = {};
      for (const rt of ['docker', 'podman'] as RuntimeName[]) {
        let projects;
        try {
          projects = await ComposeCommands.list(rt);
        } catch {
          continue;
        }
        for (const p of projects) {
          if (!p.name || !p.configFile) continue;
          let services: string[] = [];
          try {
            services = await ComposeCommands.services(rt, p.configFile);
          } catch {
            // listed without a readable service set — falls back to chips
          }
          // `rt` is the runtime that just answered compose ls/config, so it
          // is known to have a working compose provider — unlike the
          // container runtime, which dedup can report as the other engine.
          out[p.name] = { file: p.configFile, services, runtime: rt };
        }
      }
      if (!cancelled) setComposeStacks(out);
    })();
    return () => {
      cancelled = true;
    };
  }, [live, allContainers]);

  // Pick a compose file from disk and open the animated launch view.
  const openComposeFile = async () => {
    try {
      const path = await ComposeCommands.pickFile();
      if (path) setComposeLaunch({ filePath: path });
    } catch {
      // the picker only exists in the desktop app; the button is disabled
      // elsewhere, so this path is unreachable in practice
    }
  };

  // Scale one service of a compose stack, replaying the launch animation.
  const scaleService = (
    stack: string,
    file: string,
    rt: RuntimeName,
    service: string,
    count: number,
  ) => {
    if (count < 0) return;
    setComposeLaunch({
      filePath: file,
      runtime: rt,
      scale: [`${service}=${count}`],
      title: `Scaling ${stack}`,
    });
  };

  // Run the canonical hello-world image — a quick "does my runtime work" test.
  const runHello = (rt: RuntimeName) => {
    setLaunching(rt);
    ContainerCommands.run(rt, {
      image: 'docker.io/library/hello-world',
      ports: [],
      env: [],
      volumes: [],
      command: [],
      detach: true,
    })
      .then(() => refresh())
      .catch(() => undefined)
      .finally(() => setLaunching(null));
  };

  const containers =
    runtimeFilter === 'all'
      ? allContainers
      : allContainers.filter((c) => c.rt === runtimeFilter);

  const [filter, setFilter] = useState<StatusFilter>('all');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [groupBy, setGroupBy] = useState<GroupBy>('flat');

  const filtered = useMemo(
    () =>
      containers.filter((c) => {
        if (filter !== 'all' && c.status !== filter) return false;
        if (query) {
          const q = query.toLowerCase();
          return (
            c.name.toLowerCase().includes(q) ||
            c.image.toLowerCase().includes(q) ||
            c.tag.toLowerCase().includes(q)
          );
        }
        return true;
      }),
    [containers, query, filter],
  );

  const grouped = useMemo(() => {
    if (groupBy === 'flat') return [{ key: 'All', items: filtered }];
    const map: Record<string, Container[]> = {};
    filtered.forEach((c) => {
      const k = c[groupBy];
      (map[k] = map[k] || []).push(c);
    });
    return Object.entries(map).map(([key, items]) => ({ key, items }));
  }, [filtered, groupBy]);

  // Real compose stacks, derived from the live container inventory.
  const stacks = useMemo(
    () => Array.from(new Set(containers.map((c) => c.stack))).sort(),
    [containers],
  );

  const filters: { k: StatusFilter; l: string }[] = [
    { k: 'all', l: `All ${containers.length}` },
    { k: 'running', l: `Running ${containers.filter((c) => c.status === 'running').length}` },
    { k: 'paused', l: `Paused ${containers.filter((c) => c.status === 'paused').length}` },
    { k: 'stopped', l: `Stopped ${containers.filter((c) => c.status === 'stopped').length}` },
  ];

  return (
    <div className="bento">
      <div className="stat-strip" style={{ gridColumn: 'span 6' }}>
        <StatTile value={containers.filter((c) => c.status === 'running').length} label="Running" section="Live" sectionIcon="bolt" tone="violet" onClick={() => setFilter('running')} />
        <StatTile value={containers.filter((c) => c.status === 'paused').length} label="Paused" section="Idle" sectionIcon="pause" tone="warn" onClick={() => setFilter('paused')} suffix="" />
        <StatTile value={containers.filter((c) => c.status === 'stopped').length} label="Stopped" section="Cold" sectionIcon="stop" tone="dim" onClick={() => setFilter('stopped')} suffix="" />
      </div>

      <BentoCard section="Filters" sectionIcon="filter" title="View" span={6} headerAlign="left">
        <div className="filter-row">
          <div className="filter-group">
            <div className="bc-section">
              <span>Status</span>
            </div>
            <div className="fchip-row">
              {filters.map((f) => (
                <button
                  key={f.k}
                  type="button"
                  className={`fchip ${filter === f.k ? 'is-on' : ''}`}
                  onClick={() => setFilter(f.k)}
                >
                  {f.l}
                </button>
              ))}
            </div>
          </div>
          <div className="filter-group">
            <div className="bc-section">
              <span>Group by</span>
            </div>
            <div className="fchip-row">
              {(['flat', 'stack', 'image', 'tag'] as GroupBy[]).map((g) => (
                <button
                  key={g}
                  type="button"
                  className={`fchip ${groupBy === g ? 'is-on' : ''}`}
                  onClick={() => setGroupBy(g)}
                >
                  {g}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="bulk-actions">
          <button className="action-btn" type="button" onClick={startAllStopped}>
            <Glyph name="play" size={12} /> Start all stopped
          </button>
          <button className="action-btn" type="button">
            <Glyph name="restart" size={12} /> Restart selected
          </button>
          <button className="action-btn danger" type="button">
            <Glyph name="trash" size={12} /> Remove stopped
          </button>
        </div>
      </BentoCard>

      <BentoCard
        section="Inventory"
        sectionIcon="container"
        title={`Containers · ${filtered.length}`}
        span={12}
        className="card-flush"
        headerAlign="left"
        headerAside={
          <button
            className="action-btn primary"
            type="button"
            onClick={() => setRunOpen(true)}
          >
            <Glyph name="plus" size={12} /> Run Container
          </button>
        }
      >
        <div className="ctable">
          <div className="cth">
            <div>Name</div>
            <div>Image</div>
            <div>Stack</div>
            <div>Port</div>
            <div>CPU</div>
            <div>Mem</div>
            <div>Uptime</div>
            <div>Actions</div>
          </div>

          {grouped.map((g) => (
            <Fragment key={g.key}>
              {groupBy !== 'flat' && (
                <div className="ctr-group">
                  <Glyph name="dot" size={10} /> {g.key}
                  <span className="mono">{g.items.length}</span>
                  {groupBy === 'stack' && (
                    <span style={{ display: 'flex', gap: 2 }}>
                      <button
                        className="iconbtn"
                        type="button"
                        title="Start whole stack"
                        onClick={() => startStack(g.key)}
                      >
                        <Glyph name="play" size={13} />
                      </button>
                      <button
                        className="iconbtn"
                        type="button"
                        title="Stop whole stack"
                        onClick={() => stopStack(g.key)}
                      >
                        <Glyph name="stop" size={13} />
                      </button>
                    </span>
                  )}
                </div>
              )}
              {g.items.map((c) => (
                <Fragment key={c.id}>
                  <div
                    className={`ctr-row ${expanded === c.id ? 'is-open' : ''}`}
                    onClick={() => setExpanded(expanded === c.id ? null : c.id)}
                  >
                    <div className="col-name">
                      <StatusDot status={c.status} />
                      <div className="name-stack">
                        <div className="name-main">
                          {c.name}
                          <RuntimeBadge rt={c.rt} size="xs" showLabel={false} />
                        </div>
                        <div className="name-sub mono">{c.id}</div>
                      </div>
                    </div>
                    <div className="mono cell-ellipsis">{c.image}</div>
                    <div>
                      <Pill tone="dim">{c.stack}</Pill>
                    </div>
                    <div className="mono cell-ellipsis">{c.port}</div>
                    <div className="col-cpu">
                      <div className="bar">
                        <div className="bar-fill" style={{ width: `${Math.min(c.cpu * 8, 100)}%` }} />
                      </div>
                      <span className="mono">{c.cpu.toFixed(1)}%</span>
                    </div>
                    <div className="mono">{c.mem ? `${c.mem} MB` : '—'}</div>
                    <div className="mono">{c.uptime}</div>
                    <div className="col-act" onClick={(e) => e.stopPropagation()}>
                      {c.status !== 'running' && (
                        <button className="iconbtn" type="button" title="Start" onClick={() => setContainerStatus(c.id, 'running')}>
                          <Glyph name="play" size={13} />
                        </button>
                      )}
                      {c.status === 'running' && (
                        <>
                          <button className="iconbtn" type="button" title="Open shell" onClick={() => setExecTarget(c)}>
                            <Glyph name="terminal" size={13} />
                          </button>
                          <button className="iconbtn" type="button" title="Pause" onClick={() => setContainerStatus(c.id, 'paused')}>
                            <Glyph name="pause" size={13} />
                          </button>
                          <button className="iconbtn" type="button" title="Stop" onClick={() => setContainerStatus(c.id, 'stopped')}>
                            <Glyph name="stop" size={13} />
                          </button>
                        </>
                      )}
                      <button className="iconbtn" type="button" title="Configure resources" onClick={() => setResourceTarget(c)}>
                        <Glyph name="cpu" size={13} />
                      </button>
                      <button className="iconbtn" type="button" title="Restart" onClick={() => restartContainer(c.id)}>
                        <Glyph name="restart" size={13} />
                      </button>
                      <button className="iconbtn danger" type="button" title="Remove" onClick={() => removeContainer(c.id)}>
                        <Glyph name="trash" size={13} />
                      </button>
                    </div>
                  </div>

                  {expanded === c.id && (
                    <ContainerDetail container={c} onExec={setExecTarget} />
                  )}
                </Fragment>
              ))}
            </Fragment>
          ))}

          {filtered.length === 0 &&
            (launching ? (
              <LaunchCard rt={launching} />
            ) : (
            <div className="empty">
              <Glyph name="container" size={24} />
              {containers.length === 0 ? (
                <>
                  <div>No containers yet — launch any image, or run a quick test.</div>
                  <div
                    style={{
                      display: 'flex',
                      gap: 6,
                      flexWrap: 'wrap',
                      justifyContent: 'center',
                    }}
                  >
                    <button
                      className="action-btn primary"
                      type="button"
                      onClick={() => setRunOpen(true)}
                    >
                      <Glyph name="plus" size={12} /> Run Container
                    </button>
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
                </>
              ) : (
                <>
                  <div>No containers match this filter.</div>
                  <button
                    className="action-btn"
                    type="button"
                    onClick={() => {
                      setFilter('all');
                      setQuery('');
                    }}
                  >
                    Clear filters
                  </button>
                </>
              )}
            </div>
            ))}
        </div>
      </BentoCard>

      <BentoCard
        section="Composition"
        sectionIcon="container"
        title="Compose Stacks"
        span={6}
        headerAlign="left"
        headerAside={
          <button
            className="action-btn"
            type="button"
            onClick={openComposeFile}
            disabled={!live}
            title={live ? undefined : 'Requires the desktop app'}
          >
            <Glyph name="folder" size={12} /> Open compose file
          </button>
        }
      >
        <div className="stack-cards">
          {stacks.length === 0 && (
            <div className="empty">
              <Glyph name="container" size={24} />
              <div>No compose stacks detected.</div>
            </div>
          )}
          {stacks.map((s) => {
            const items = containers.filter((c) => c.stack === s);
            const running = items.filter((c) => c.status === 'running').length;
            const info = composeStacks[s];
            return (
              <div key={s} className="stack-card">
                <div className="stack-card-h">
                  <div className="stack-name">{s}</div>
                  <Pill tone={running === items.length ? 'ok' : 'warn'}>
                    {running}/{items.length} up
                  </Pill>
                </div>
                {info && info.services.length > 0 ? (
                  <div className="svc-list">
                    {info.services.map((svc) => {
                      const n = replicaCount(items, svc);
                      return (
                        <div key={svc} className="svc-row">
                          <span className="svc-name mono">{svc}</span>
                          <span className="svc-count-label">
                            {n} {n === 1 ? 'replica' : 'replicas'}
                          </span>
                          <div className="svc-stepper">
                            <button
                              type="button"
                              className="iconbtn"
                              title={`Scale ${svc} down`}
                              disabled={n <= 0}
                              onClick={() => scaleService(s, info.file, info.runtime, svc, n - 1)}
                            >
                              <Glyph name="minus" size={13} />
                            </button>
                            <span className="svc-count mono">{n}</span>
                            <button
                              type="button"
                              className="iconbtn"
                              title={`Scale ${svc} up`}
                              onClick={() => scaleService(s, info.file, info.runtime, svc, n + 1)}
                            >
                              <Glyph name="plus" size={13} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="stack-card-body">
                    {items.map((c) => (
                      <span key={c.id} className="stack-chip">
                        <StatusDot status={c.status} /> {c.name}
                      </span>
                    ))}
                  </div>
                )}
                <div className="stack-card-foot">
                  <button className="text-btn" type="button" onClick={() => startStack(s)}>
                    start all
                  </button>
                  <button className="text-btn" type="button" onClick={() => stopStack(s)}>
                    stop all
                  </button>
                  {info && (
                    <button
                      className="text-btn"
                      type="button"
                      onClick={() =>
                        setComposeLaunch({
                          filePath: info.file,
                          runtime: info.runtime,
                          title: `Re-up ${s}`,
                        })
                      }
                    >
                      re-up
                    </button>
                  )}
                  <button className="text-btn" type="button">
                    logs
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </BentoCard>

      <BentoCard section="Shell" sectionIcon="command" title="Exec History" span={6} headerAlign="left">
        <div className="exec-list">
          {EXEC_HISTORY.map((e, i) => (
            <div key={i} className="exec-row">
              <span className={`exec-exit ${e.exit === 0 ? 'ok' : 'bad'}`}>{e.exit}</span>
              <div className="exec-body">
                <div className="exec-cmd mono">{e.cmd}</div>
                <div className="exec-meta mono">
                  {e.ctr} · {e.when}
                </div>
              </div>
              <button className="text-btn" type="button">
                re-run
              </button>
            </div>
          ))}
        </div>
      </BentoCard>

      {runOpen && (
        <RunContainerModal
          defaultRuntime={composerRuntime}
          onClose={() => setRunOpen(false)}
        />
      )}
      {execTarget && (
        <ExecModal
          container={execTarget}
          onClose={() => setExecTarget(null)}
        />
      )}
      {resourceTarget && (
        <ContainerResourcesModal
          container={resourceTarget}
          onClose={() => setResourceTarget(null)}
        />
      )}
      {composeLaunch && (
        <ComposeLaunchModal
          filePath={composeLaunch.filePath}
          runtime={composeLaunch.runtime}
          scale={composeLaunch.scale}
          title={composeLaunch.title}
          onClose={() => {
            setComposeLaunch(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}
