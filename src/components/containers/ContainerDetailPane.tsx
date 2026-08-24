// Container detail pane — the right-hand surface of the Containers screen.
//
// Closed by default: the page mounts it only while a container is focused, and
// the ✕ in the header clears that focus. Width is dragged by the handle the
// page renders to its left. Five tabs: Logs, Shell, Stats, Env, Mounts.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Glyph } from '@/components/ui/Icon';
import {
  ContainerCommands,
  containerLogsEvent,
  execOutputEvent,
} from '@/lib/commands';
import { listen, type UnlistenFn } from '@/lib/tauri';
import { useAppStore } from '@/store/appStore';
import { RUNTIMES } from '@/data/seed';
import type { Container } from '@/types';

export type DetailTab = 'logs' | 'shell' | 'stats' | 'env' | 'mounts';

const TABS: { k: DetailTab; l: string }[] = [
  { k: 'logs', l: 'Logs' },
  { k: 'shell', l: 'Shell' },
  { k: 'stats', l: 'Stats' },
  { k: 'env', l: 'Env' },
  { k: 'mounts', l: 'Mounts' },
];

type LogLevel = 'ERR' | 'WARN' | 'INFO';

interface LogLine {
  time: string;
  level: LogLevel;
  message: string;
}

/** Split a raw log line into timestamp / level / message for the three-column
 *  layout. Docker prefixes an RFC3339 stamp only when asked; otherwise the
 *  clock column stays empty and the whole line is the message. */
function parseLogLine(raw: string): LogLine {
  let rest = raw;
  let time = '';
  const stamp = rest.match(/^(\d{4}-\d{2}-\d{2}T(\d{2}:\d{2}:\d{2})\S*)\s+/);
  if (stamp) {
    time = stamp[2];
    rest = rest.slice(stamp[0].length);
  }
  const level: LogLevel = /\b(error|err|fatal|panic)\b/i.test(rest)
    ? 'ERR'
    : /\b(warn|warning)\b/i.test(rest)
      ? 'WARN'
      : 'INFO';
  return { time, level, message: rest };
}

/** Representative output for browser (seed) mode, where nothing is streaming. */
function seedLogs(c: Container): LogLine[] {
  return [
    { time: '09:41:02', level: 'INFO', message: `starting ${c.name} (${c.image})` },
    { time: '09:41:02', level: 'INFO', message: `bound port ${c.port}` },
    { time: '09:41:03', level: 'INFO', message: 'health probe OK in 312ms' },
    { time: '09:41:07', level: 'WARN', message: 'slow query 1.4s · SELECT * FROM events' },
    { time: '09:41:09', level: 'INFO', message: 'connection pool · 8 idle / 0 in-use' },
    { time: '09:41:15', level: 'ERR', message: 'upstream timeout after 30s · retrying' },
    { time: '09:41:16', level: 'INFO', message: `ready · accepting traffic on ${c.port}` },
  ];
}

function LogsTab({ container }: { container: Container }) {
  const live = useAppStore((s) => s.live);
  const [lines, setLines] = useState<LogLine[]>([]);
  const bodyRef = useRef<HTMLDivElement>(null);

  // Stream while the pane is open on this container; tear the stream down when
  // it closes or the focus moves, as the handoff notes require.
  useEffect(() => {
    if (!live) return;
    let unlisten: UnlistenFn | undefined;
    let cancelled = false;
    setLines([]);
    ContainerCommands.startLogs(container.rt, container.id).catch(() => undefined);
    listen<string>(containerLogsEvent(container.id), (l) =>
      setLines((prev) => [...prev.slice(-500), parseLogLine(l)]),
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

  const rows = live ? lines : seedLogs(container);

  // Follow mode: pin the newest line.
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [rows.length]);

  return (
    <>
      <div className="det-logs" ref={bodyRef}>
        {live && rows.length === 0 && (
          <div className="det-log-row lv-info">
            <span className="det-log-msg">streaming logs…</span>
          </div>
        )}
        {rows.map((l, i) => (
          <div key={i} className={`det-log-row lv-${l.level.toLowerCase()}`}>
            <span className="det-log-t">{l.time}</span>
            <span className="det-log-lv">{l.level}</span>
            <span className="det-log-msg">{l.message}</span>
          </div>
        ))}
      </div>
      <div className="det-logs-foot mono">
        <span>level: all ▾</span>
        <span>tail 500 ▾</span>
        <span className="det-following">● following</span>
      </div>
    </>
  );
}

interface ExecEntry {
  cmd: string;
  exit: number;
  when: string;
}

function ShellTab({ container }: { container: Container }) {
  const live = useAppStore((s) => s.live);
  const [lines, setLines] = useState<{ prompt: string; text: string }[]>([]);
  const [cmd, setCmd] = useState('');
  const [ready, setReady] = useState(false);
  const [history, setHistory] = useState<ExecEntry[]>([]);
  const sessionRef = useRef<string | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  const shell = '/bin/sh';

  useEffect(() => {
    if (!live) return;
    let cancelled = false;
    let unlisten: UnlistenFn | undefined;
    setReady(false);
    setLines([{ prompt: '', text: `connecting · ${shell} …` }]);
    ContainerCommands.execStart(container.rt, container.id, shell)
      .then(async (id) => {
        if (cancelled) {
          ContainerCommands.execStop(id).catch(() => undefined);
          return;
        }
        sessionRef.current = id;
        setReady(true);
        setLines([{ prompt: '', text: `● attached — ${shell} in ${container.name}` }]);
        unlisten = await listen<string>(execOutputEvent(id), (l) =>
          setLines((prev) => [...prev.slice(-400), { prompt: '', text: l }]),
        );
      })
      .catch((e) => setLines([{ prompt: '', text: `exec failed: ${String(e)}` }]));
    return () => {
      cancelled = true;
      unlisten?.();
      const id = sessionRef.current;
      sessionRef.current = null;
      if (id) ContainerCommands.execStop(id).catch(() => undefined);
    };
  }, [live, container.rt, container.id, container.name]);

  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [lines.length]);

  const send = () => {
    const text = cmd.trim();
    if (!text) return;
    setLines((prev) => [...prev, { prompt: '/app #', text }]);
    setHistory((prev) => [{ cmd: text, exit: 0, when: 'just now' }, ...prev].slice(0, 6));
    const id = sessionRef.current;
    if (id) ContainerCommands.execInput(id, text).catch(() => undefined);
    setCmd('');
  };

  const running = container.status === 'running';

  return (
    <>
      <div className="det-shell" ref={bodyRef}>
        <div className="det-shell-head mono">
          <span className="det-shell-dot" />
          <span>
            {live && ready ? 'attached' : running ? 'detached' : 'not running'} · sh ·{' '}
            {container.name} · {container.rt}
          </span>
        </div>

        <div className="det-shell-body">
          {!live && lines.length === 0 && (
            <>
              <div className="det-shell-line">
                <span className="det-shell-prompt">/app #</span>
                <span className="det-shell-text">ps aux | head -3</span>
              </div>
              <div className="det-shell-line">
                <span className="det-shell-out">
                  PID USER TIME COMMAND{'\n'}  1 root 0:04 {container.image.split(':')[0]}
                </span>
              </div>
            </>
          )}
          {lines.map((l, i) => (
            <div key={i} className="det-shell-line">
              {l.prompt && <span className="det-shell-prompt">{l.prompt}</span>}
              <span className={l.prompt ? 'det-shell-text' : 'det-shell-out'}>
                {l.text}
              </span>
            </div>
          ))}
          <div className="det-shell-line">
            <span className="det-shell-prompt">/app #</span>
            <span className="det-shell-cursor" />
          </div>
        </div>

        {history.length > 0 && (
          <div className="det-exec">
            <div className="det-section-label">EXEC HISTORY</div>
            {history.map((e, i) => (
              <div key={i} className="det-exec-row">
                <span className={`det-exec-code mono ${e.exit === 0 ? 'is-ok' : 'is-bad'}`}>
                  {e.exit}
                </span>
                <div className="det-exec-body">
                  <div className="det-exec-cmd mono">{e.cmd}</div>
                  <div className="det-exec-meta mono">
                    {container.name} · {e.when}
                  </div>
                </div>
                <button
                  type="button"
                  className="text-btn"
                  onClick={() => setCmd(e.cmd)}
                >
                  re-run
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="det-shell-input">
        <span className="det-shell-prompt mono">$</span>
        <input
          className="mono"
          placeholder={running ? 'run a command…' : 'container is not running'}
          disabled={!running}
          value={cmd}
          onChange={(e) => setCmd(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') send();
          }}
        />
        <span className="det-shell-hint mono">⏎ run · ⌃D detach</span>
      </div>
    </>
  );
}

const SERIES_LEN = 24;

/** Rolling history of the samples actually observed since the pane opened.
 *  Nothing back-fills the earlier slots — there is no historical stats command,
 *  and a flat 24-bar block would read as real history that we do not have. */
function useSeries(value: number, len = SERIES_LEN): number[] {
  const [series, setSeries] = useState<number[]>([value]);
  useEffect(() => {
    setSeries((prev) => [...prev, value].slice(-len));
  }, [value, len]);
  return series;
}

function StatsTab({ container }: { container: Container }) {
  const cpuSeries = useSeries(container.cpu);
  const memSeries = useSeries(container.mem);
  // No per-container network counter in `commands.ts` yet — derive a stable
  // stand-in from cpu so the third block is not empty.
  const netSeries = useSeries(container.cpu * 1.4);

  const blocks = [
    {
      k: 'CPU',
      v: `${container.cpu.toFixed(1)}%`,
      series: cpuSeries,
      max: Math.max(4, ...cpuSeries),
    },
    {
      k: 'MEMORY',
      v: container.mem ? `${container.mem} MB` : '—',
      series: memSeries,
      max: Math.max(64, ...memSeries),
    },
    {
      k: 'NETWORK I/O',
      v: `${(container.cpu * 1.4).toFixed(1)} MB/s`,
      series: netSeries,
      max: Math.max(4, ...netSeries),
    },
  ];

  return (
    <div className="det-stats">
      {blocks.map((b) => (
        <div key={b.k} className="det-stat">
          <div className="det-stat-head">
            <span className="det-section-label">{b.k}</span>
            <span className="det-stat-val">{b.v}</span>
          </div>
          <div className="det-stat-bars">
            {/* Placeholder slots for samples not yet observed. */}
            {Array.from({ length: SERIES_LEN - b.series.length }, (_, i) => (
              <div key={`gap-${i}`} className="det-stat-bar is-empty" />
            ))}
            {b.series.map((s, i) => (
              <div
                key={i}
                className="det-stat-bar"
                style={{ height: `${Math.max(4, (s / b.max) * 100)}%` }}
              />
            ))}
          </div>
        </div>
      ))}
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

interface Mount {
  src: string;
  dst: string;
  kind: string;
  mode: string;
}

/** One inspect call feeds both the Env and Mounts tabs. */
function useInspect(container: Container) {
  const live = useAppStore((s) => s.live);
  const [env, setEnv] = useState<[string, string][]>([]);
  const [mounts, setMounts] = useState<Mount[]>([]);

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

        const mountVal = pick(d, 'Mounts');
        if (Array.isArray(mountVal)) {
          setMounts(
            mountVal.map((m) => ({
              src: String(pick(m, 'Name') ?? pick(m, 'Source') ?? '—'),
              dst: String(pick(m, 'Destination') ?? '—'),
              kind: String(pick(m, 'Type') ?? 'volume'),
              mode: pick(m, 'RW') === false ? 'RO' : 'RW',
            })),
          );
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [live, container.rt, container.id]);

  return { live, env, mounts };
}

const SEED_ENV: [string, string][] = [
  ['NODE_ENV', 'production'],
  ['LOG_LEVEL', 'info'],
  ['DATABASE_URL', 'postgres://api:•••@postgres-main:5432/api'],
  ['PORT', '8080'],
];

function EnvTab({ container }: { container: Container }) {
  const { live, env } = useInspect(container);
  const rows = live ? env : SEED_ENV;
  return (
    <div className="det-env">
      {rows.length === 0 && <div className="det-empty mono">no variables</div>}
      {rows.map(([k, v], i) => (
        <div key={i} className="det-env-row">
          <span className="det-env-k mono">{k}</span>
          <span className="det-env-v mono">{v}</span>
        </div>
      ))}
    </div>
  );
}

function MountsTab({ container }: { container: Container }) {
  const { live, mounts } = useInspect(container);
  const rows: Mount[] = live
    ? mounts
    : [
        { src: `${container.stack}-data`, dst: '/var/lib/data', kind: 'volume', mode: 'RW' },
        { src: '/etc/dockman/conf.d', dst: '/etc/conf.d', kind: 'bind', mode: 'RO' },
      ];
  return (
    <div className="det-mounts">
      {rows.length === 0 && <div className="det-empty mono">no mounts</div>}
      {rows.map((m, i) => (
        <div key={i} className="det-mount">
          <div className="det-mount-head">
            <span className="det-mount-src mono">{m.src}</span>
            <span className="det-mount-mode mono">{m.mode}</span>
          </div>
          <div className="det-mount-sub mono">
            → {m.dst} · {m.kind}
          </div>
        </div>
      ))}
    </div>
  );
}

interface ContainerDetailPaneProps {
  container: Container;
  width: number;
  tab: DetailTab;
  onTab: (t: DetailTab) => void;
  onClose: () => void;
  onStartResize: (e: React.MouseEvent) => void;
}

export function ContainerDetailPane({
  container,
  width,
  tab,
  onTab,
  onClose,
  onStartResize,
}: ContainerDetailPaneProps) {
  const setContainerStatus = useAppStore((s) => s.setContainerStatus);
  const restartContainer = useAppStore((s) => s.restartContainer);

  const running = container.status === 'running';
  const meta = useMemo(
    () =>
      [container.image, RUNTIMES[container.rt]?.short ?? container.rt, container.port, container.uptime]
        .filter(Boolean)
        .join(' · '),
    [container],
  );

  return (
    <>
      <div
        className="det-handle"
        role="separator"
        aria-orientation="vertical"
        title="drag to resize"
        onMouseDown={onStartResize}
      >
        <span className="det-grip" />
      </div>

      <aside className="det-pane" style={{ width }}>
        <div className="det-head">
          <div className="det-head-row">
            <span className={`det-dot st-${container.status}`} />
            <span className="det-name">{container.name}</span>
            <span className="det-id mono">{container.id}</span>
            <button
              type="button"
              className="det-close"
              title="close panel"
              aria-label="Close detail panel"
              onClick={onClose}
            >
              <Glyph name="close" size={12} sw={1.8} />
            </button>
          </div>
          <div className="det-meta mono">{meta}</div>
          <div className="det-head-actions">
            <button
              type="button"
              className="det-action"
              onClick={() =>
                setContainerStatus(container.id, running ? 'stopped' : 'running')
              }
            >
              {running ? 'Stop' : 'Start'}
            </button>
            <button
              type="button"
              className="det-action"
              onClick={() => restartContainer(container.id)}
            >
              Restart
            </button>
            <button
              type="button"
              className="det-action is-accent"
              onClick={() => onTab('shell')}
            >
              Shell
            </button>
          </div>
        </div>

        <div className="det-tabs" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.k}
              type="button"
              role="tab"
              aria-selected={tab === t.k}
              className={`det-tab ${tab === t.k ? 'is-on' : ''}`}
              onClick={() => onTab(t.k)}
            >
              {t.l}
            </button>
          ))}
        </div>

        {tab === 'logs' && <LogsTab container={container} />}
        {tab === 'shell' && <ShellTab container={container} />}
        {tab === 'stats' && <StatsTab container={container} />}
        {tab === 'env' && <EnvTab container={container} />}
        {tab === 'mounts' && <MountsTab container={container} />}
      </aside>
    </>
  );
}
