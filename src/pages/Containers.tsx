// Containers — full management view: filterable table with expandable detail
// rows, compose-stack grouping and exec history.

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { BentoCard } from '@/components/ui/BentoCard';
import { StatTile } from '@/components/ui/StatTile';
import { Glyph } from '@/components/ui/Icon';
import { Pill, StatusDot } from '@/components/ui/Badge';
import { RuntimeBadge } from '@/components/ui/Runtime';
import { LaunchCard } from '@/components/ui/LaunchCard';
import { useAppStore } from '@/store/appStore';
import { ContainerCommands, containerLogsEvent, execOutputEvent } from '@/lib/commands';
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
 *  shows representative sample output in the browser. */
function ContainerLogs({ container }: { container: Container }) {
  const live = useAppStore((s) => s.live);
  const [lines, setLines] = useState<string[]>([]);

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

  if (!live) {
    return (
      <pre className="logs">
        <div>
          [info] starting {container.name} ({container.image})
        </div>
        <div>[info] bound port {container.port}</div>
        <div>[info] health probe OK in 312ms</div>
        <div>[debug] connection pool · 8 idle / 0 in-use</div>
        <div>[info] ready · accepting traffic on {container.port}</div>
      </pre>
    );
  }
  return (
    <pre className="logs">
      {lines.length === 0 ? (
        <div>streaming logs…</div>
      ) : (
        lines.map((l, i) => <div key={i}>{l}</div>)
      )}
    </pre>
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

/** Inline pipe-based exec shell for a running container. */
function ExecTerminal({ container }: { container: Container }) {
  const live = useAppStore((s) => s.live);
  const [lines, setLines] = useState<string[]>(['connecting…']);
  const [cmd, setCmd] = useState('');
  const sessionRef = useRef<string | null>(null);

  useEffect(() => {
    if (!live) return;
    let cancelled = false;
    let unlisten: UnlistenFn | undefined;
    ContainerCommands.execStart(container.rt, container.id, '/bin/sh')
      .then(async (id) => {
        if (cancelled) {
          ContainerCommands.execStop(id).catch(() => undefined);
          return;
        }
        sessionRef.current = id;
        setLines(['shell ready — type a command and press Enter']);
        unlisten = await listen<string>(execOutputEvent(id), (l) =>
          setLines((prev) => [...prev.slice(-300), l]),
        );
      })
      .catch((e) => setLines([`exec failed: ${String(e)}`]));
    return () => {
      cancelled = true;
      unlisten?.();
      const id = sessionRef.current;
      if (id) ContainerCommands.execStop(id).catch(() => undefined);
    };
  }, [live, container.rt, container.id]);

  if (!live) {
    return (
      <div className="det-label">Exec is available when running the desktop app.</div>
    );
  }

  const send = () => {
    const id = sessionRef.current;
    if (!id || !cmd.trim()) return;
    setLines((prev) => [...prev, `$ ${cmd}`]);
    ContainerCommands.execInput(id, `${cmd}\n`).catch(() => undefined);
    setCmd('');
  };

  return (
    <div>
      <div className="det-label" style={{ marginBottom: 6 }}>
        Shell · {container.name}
      </div>
      <pre className="logs" style={{ maxHeight: 200 }}>
        {lines.map((l, i) => (
          <div key={i}>{l}</div>
        ))}
      </pre>
      <div className="pull-input" style={{ marginTop: 6 }}>
        <Glyph name="command" size={13} />
        <input
          value={cmd}
          onChange={(e) => setCmd(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') send();
          }}
          placeholder="/bin/sh — e.g. ls -la"
        />
      </div>
    </div>
  );
}

/** Expanded container detail: live logs, environment, network + exec shell. */
function ContainerDetail({ container }: { container: Container }) {
  const live = useAppStore((s) => s.live);
  const [showExec, setShowExec] = useState(false);
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
    <>
      <div className="ctr-detail">
        <div className="det-col">
          <div className="det-label">Logs · live</div>
          <ContainerLogs container={container} />
        </div>
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
              onClick={() => setShowExec((v) => !v)}
            >
              <Glyph name="command" size={12} /> {showExec ? 'Close shell' : 'Exec'}
            </button>
          </div>
        </div>
      </div>
      {showExec && running && (
        <div
          style={{
            padding: '14px 18px 18px',
            background: 'var(--bg)',
            borderBottom: '0.5px solid var(--line)',
          }}
        >
          <ExecTerminal container={container} />
        </div>
      )}
    </>
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
  const [launching, setLaunching] = useState<RuntimeName | null>(null);

  // Run the canonical hello-world image — a quick "does my runtime work" test.
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
                          <button className="iconbtn" type="button" title="Pause" onClick={() => setContainerStatus(c.id, 'paused')}>
                            <Glyph name="pause" size={13} />
                          </button>
                          <button className="iconbtn" type="button" title="Stop" onClick={() => setContainerStatus(c.id, 'stopped')}>
                            <Glyph name="stop" size={13} />
                          </button>
                        </>
                      )}
                      <button className="iconbtn" type="button" title="Restart" onClick={() => restartContainer(c.id)}>
                        <Glyph name="restart" size={13} />
                      </button>
                      <button className="iconbtn danger" type="button" title="Remove" onClick={() => removeContainer(c.id)}>
                        <Glyph name="trash" size={13} />
                      </button>
                    </div>
                  </div>

                  {expanded === c.id && <ContainerDetail container={c} />}
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
                  <div>No containers yet — run a test image to check your runtime.</div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
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
                        <Glyph name="play" size={12} /> Run hello-world on {rt}
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

      <BentoCard section="Composition" sectionIcon="container" title="Compose Stacks" span={6} headerAlign="left">
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
            return (
              <div key={s} className="stack-card">
                <div className="stack-card-h">
                  <div className="stack-name">{s}</div>
                  <Pill tone={running === items.length ? 'ok' : 'warn'}>
                    {running}/{items.length} up
                  </Pill>
                </div>
                <div className="stack-card-body">
                  {items.map((c) => (
                    <span key={c.id} className="stack-chip">
                      <StatusDot status={c.status} /> {c.name}
                    </span>
                  ))}
                </div>
                <div className="stack-card-foot">
                  <button className="text-btn" type="button" onClick={() => startStack(s)}>
                    start all
                  </button>
                  <button className="text-btn" type="button" onClick={() => stopStack(s)}>
                    stop all
                  </button>
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
    </div>
  );
}
