// Containers — the console screen: a dense stack-grouped table with bulk
// actions and multi-select, plus a closable, resizable detail pane.
//
// Layout is a flex row: the table column takes the remaining width, and the
// detail pane (mounted only while a container is focused) sits to its right
// behind a drag handle.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Glyph } from '@/components/ui/Icon';
import { RunContainerModal } from '@/components/ui/RunContainerModal';
import { ComposeLaunchModal } from '@/components/ui/ComposeLaunchModal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EngineDown, SkeletonRows } from '@/components/ui/Skeleton';
import {
  ContainerDetailPane,
  type DetailTab,
} from '@/components/containers/ContainerDetailPane';
import { useAppStore } from '@/store/appStore';
import { ComposeCommands, RuntimeCommands, SystemCommands } from '@/lib/commands';
import { splitPorts } from '@/lib/parsers';
import { useRuntimes } from '@/hooks/useData';
import { RUNTIMES } from '@/data/seed';
import type { Container, RuntimeName, StatusFilter } from '@/types';

const PANE_MIN = 280;
const PANE_MAX = 560;
const PANE_DEFAULT = 372;
const PANE_KEY = 'dockman-detail-pane-width';

const PORT_CHIPS = 2;

/**
 * Ports as chips rather than the runtime's raw string.
 *
 * `0.0.0.0:1025->1025/tcp, [::]:8025->8025/tcp, 1110/tcp` wrapped to three
 * lines and pushed the row height out. Published host ports are the part a
 * user acts on, so they show as chips that open the port; unpublished ones
 * collapse into a count. The full string stays available on hover.
 */
function PortsCell({ raw }: { raw: string }) {
  const all = splitPorts(raw);
  const published = all.filter((p) => p.host);
  const internal = all.length - published.length;

  if (all.length === 0) return <span className="col-ports port-none mono">—</span>;

  const shown = published.slice(0, PORT_CHIPS);
  const morePublished = published.length - shown.length;

  return (
    <span className="col-ports port-cell" title={raw}>
      {shown.map((p) => (
        <button
          key={`${p.host}/${p.proto}`}
          type="button"
          className="port-chip mono"
          title={`open localhost:${p.host} · container ${p.container}/${p.proto}`}
          onClick={(e) => {
            e.stopPropagation();
            SystemCommands.openUrl(`http://localhost:${p.host}`).catch(() => undefined);
          }}
        >
          {p.host}
        </button>
      ))}
      {morePublished > 0 && (
        <span className="port-more mono">+{morePublished}</span>
      )}
      {published.length === 0 && internal > 0 && (
        <span className="port-none mono">internal</span>
      )}
      {published.length > 0 && internal > 0 && (
        <span className="port-more mono" title={`${internal} unpublished`}>
          ·{internal}
        </span>
      )}
    </span>
  );
}

interface StackInfo {
  file: string;
  services: string[];
  runtime: RuntimeName;
}

export default function Containers() {
  const allContainers = useAppStore((s) => s.containers);
  const runtimeFilter = useAppStore((s) => s.runtimeFilter);
  const query = useAppStore((s) => s.query);
  const statusFilter = useAppStore((s) => s.statusFilter);
  const setStatusFilter = useAppStore((s) => s.setStatusFilter);
  const selection = useAppStore((s) => s.selection);
  const toggleSelected = useAppStore((s) => s.toggleSelected);
  const toggleSelectedMany = useAppStore((s) => s.toggleSelectedMany);
  const clearSelection = useAppStore((s) => s.clearSelection);
  const focusedContainer = useAppStore((s) => s.focusedContainer);
  const setFocusedContainer = useAppStore((s) => s.setFocusedContainer);
  const replicas = useAppStore((s) => s.replicas);
  const setReplicas = useAppStore((s) => s.setReplicas);

  const setContainerStatus = useAppStore((s) => s.setContainerStatus);
  const restartContainer = useAppStore((s) => s.restartContainer);
  const removeContainer = useAppStore((s) => s.removeContainer);
  const toggleRunPause = useAppStore((s) => s.toggleRunPause);
  const startAllStopped = useAppStore((s) => s.startAllStopped);
  const restartAllRunning = useAppStore((s) => s.restartAllRunning);
  const stopAllRunning = useAppStore((s) => s.stopAllRunning);
  const actOnSelection = useAppStore((s) => s.actOnSelection);
  const startStack = useAppStore((s) => s.startStack);
  const stopStack = useAppStore((s) => s.stopStack);
  const restartStack = useAppStore((s) => s.restartStack);
  const refresh = useAppStore((s) => s.refresh);
  const live = useAppStore((s) => s.live);
  const loading = useAppStore((s) => s.loading);
  const { runtimes, refetch: refetchRuntimes } = useRuntimes();

  const [startingEngine, setStartingEngine] = useState(false);
  const [detailTab, setDetailTab] = useState<DetailTab>('logs');
  const [paneWidth, setPaneWidth] = useState(() => {
    const stored = Number(localStorage.getItem(PANE_KEY));
    return stored >= PANE_MIN && stored <= PANE_MAX ? stored : PANE_DEFAULT;
  });
  const [runOpen, setRunOpen] = useState(false);
  const [confirm, setConfirm] = useState<'stop-all' | 'remove-selection' | null>(null);
  const [composeStacks, setComposeStacks] = useState<Record<string, StackInfo>>({});
  const [composeLaunch, setComposeLaunch] = useState<{
    filePath: string;
    runtime?: RuntimeName;
    scale?: string[];
    title?: string;
  } | null>(null);

  // ─── Drag-to-resize the detail pane ──────────────────────────────────────
  const startResize = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startW = paneWidth;
      const onMove = (ev: MouseEvent) => {
        const w = Math.min(
          PANE_MAX,
          Math.max(PANE_MIN, startW + (startX - ev.clientX)),
        );
        setPaneWidth(w);
      };
      const onUp = () => {
        document.body.style.cursor = '';
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      // Hold the resize cursor on <body> so it does not flicker over children.
      document.body.style.cursor = 'col-resize';
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [paneWidth],
  );

  useEffect(() => {
    localStorage.setItem(PANE_KEY, String(paneWidth));
  }, [paneWidth]);

  // Clean up the cursor override if the page unmounts mid-drag.
  useEffect(() => () => {
    document.body.style.cursor = '';
  }, []);

  // ─── Compose projects → file + services, for the group controls ──────────
  useEffect(() => {
    if (!live) return;
    let cancelled = false;
    (async () => {
      const out: Record<string, StackInfo> = {};
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
            // listed without a readable service set — controls degrade to the
            // per-container path below
          }
          out[p.name] = { file: p.configFile, services, runtime: rt };
        }
      }
      if (!cancelled) setComposeStacks(out);
    })();
    return () => {
      cancelled = true;
    };
  }, [live, allContainers]);

  // ─── Filtering ───────────────────────────────────────────────────────────
  const containers = useMemo(
    () =>
      runtimeFilter === 'all'
        ? allContainers
        : allContainers.filter((c) => c.rt === runtimeFilter),
    [allContainers, runtimeFilter],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return containers.filter((c) => {
      if (statusFilter !== 'all' && c.status !== statusFilter) return false;
      if (!q) return true;
      return (
        c.name.toLowerCase().includes(q) ||
        c.image.toLowerCase().includes(q) ||
        c.tag.toLowerCase().includes(q)
      );
    });
  }, [containers, query, statusFilter]);

  const groups = useMemo(() => {
    const map = new Map<string, Container[]>();
    filtered.forEach((c) => {
      const list = map.get(c.stack);
      if (list) list.push(c);
      else map.set(c.stack, [c]);
    });
    return Array.from(map.entries())
      .map(([key, items]) => ({ key, items }))
      .sort((a, b) => a.key.localeCompare(b.key));
  }, [filtered]);

  const runningCount = containers.filter((c) => c.status === 'running').length;
  const visibleIds = filtered.map((c) => c.id);
  const allVisibleSelected =
    visibleIds.length > 0 && visibleIds.every((id) => selection.includes(id));

  const focused = allContainers.find((c) => c.id === focusedContainer) ?? null;

  const filters: { k: StatusFilter; l: string }[] = [
    { k: 'all', l: `All ${containers.length}` },
    { k: 'running', l: `Running ${runningCount}` },
    {
      k: 'paused',
      l: `Paused ${containers.filter((c) => c.status === 'paused').length}`,
    },
    {
      k: 'stopped',
      l: `Stopped ${containers.filter((c) => c.status === 'stopped').length}`,
    },
  ];

  const selectedNames = useMemo(() => {
    const names = allContainers
      .filter((c) => selection.includes(c.id))
      .map((c) => c.name);
    const head = names.slice(0, 2).join(', ');
    return names.length > 2 ? `${head} +${names.length - 2}` : head;
  }, [allContainers, selection]);

  // ─── Stack-level actions ─────────────────────────────────────────────────
  const stackUp = (stack: string) => {
    const info = composeStacks[stack];
    if (info) setComposeLaunch({ filePath: info.file, runtime: info.runtime, title: `Up ${stack}` });
    else startStack(stack);
  };

  const stackDown = async (stack: string) => {
    const info = composeStacks[stack];
    if (info) {
      try {
        await ComposeCommands.down(info.runtime, info.file);
      } catch {
        // fall through to the per-container path so the click still lands
        await stopStack(stack);
      }
      await refresh();
    } else {
      await stopStack(stack);
    }
  };

  // The stepper is project-level; compose scales per service, so it drives the
  // project's first service. Disabled when no compose file is known.
  const scaleStack = (stack: string, next: number) => {
    setReplicas(stack, next);
    const info = composeStacks[stack];
    const service = info?.services[0];
    if (!info || !service) return;
    setComposeLaunch({
      filePath: info.file,
      runtime: info.runtime,
      scale: [`${service}=${Math.min(9, Math.max(0, next))}`],
      title: `Scaling ${stack} · ${service}`,
    });
  };

  const openComposeFile = async (stack: string) => {
    try {
      const path = await ComposeCommands.pickFile();
      if (path)
        setComposeLaunch({
          filePath: path,
          runtime: composeStacks[stack]?.runtime,
          title: `Up ${stack}`,
        });
    } catch {
      // desktop-only picker; the control is disabled in the browser
    }
  };

  // The engine that would be serving this list, when it is not running.
  const downEngine =
    runtimeFilter !== 'all'
      ? runtimes[runtimeFilter].running
        ? null
        : runtimeFilter
      : (['docker', 'podman'] as RuntimeName[]).every((rt) => !runtimes[rt].running)
        ? 'docker'
        : null;

  const startEngine = (rt: string) => {
    setStartingEngine(true);
    RuntimeCommands.startDaemon(rt as RuntimeName)
      .catch(() => undefined)
      .finally(() => {
        refetchRuntimes();
        refresh();
        setStartingEngine(false);
      });
  };

  const openRow = (c: Container, tab: DetailTab = 'logs') => {
    setFocusedContainer(c.id);
    setDetailTab(tab);
  };

  return (
    <div className="ctr-screen">
      <div className="ctr-main">
        {/* ─── Toolbar ─────────────────────────────────────────────────── */}
        <div className="ctr-toolbar">
          <div className="ctr-pills">
            {filters.map((f) => (
              <button
                key={f.k}
                type="button"
                className={`ctr-pill ${statusFilter === f.k ? 'is-on' : ''}`}
                onClick={() => setStatusFilter(f.k)}
                aria-pressed={statusFilter === f.k}
              >
                {f.l}
              </button>
            ))}
          </div>

          <div className="ctr-tools">
            <button
              type="button"
              className="tool-btn is-danger"
              disabled={runningCount === 0}
              onClick={() => setConfirm('stop-all')}
            >
              <Glyph name="stop" size={10} fill="currentColor" sw={0} />
              Stop all running · {runningCount}
            </button>
            <button type="button" className="tool-btn" onClick={startAllStopped}>
              <Glyph name="play" size={10} fill="currentColor" sw={0} />
              Start all stopped
            </button>
            <button type="button" className="tool-btn" onClick={restartAllRunning}>
              <Glyph name="restart" size={12} sw={1.8} />
              Restart all
            </button>
            <button
              type="button"
              className="tool-btn is-primary"
              onClick={() => setRunOpen(true)}
            >
              <Glyph name="plus" size={12} sw={2} />
              Run container
            </button>
          </div>
        </div>

        {/* ─── Column header ───────────────────────────────────────────── */}
        <div className="ctr-thead mono">
          <button
            type="button"
            className={`ctr-check ${allVisibleSelected ? 'is-on' : ''}`}
            aria-label="Select all containers"
            onClick={() => toggleSelectedMany(visibleIds)}
          >
            {allVisibleSelected && <Glyph name="check" size={10} sw={3} />}
          </button>
          <span className="col-name">NAME</span>
          <span className="col-image">IMAGE</span>
          <span className="col-ports">PORTS</span>
          <span className="col-cpu">CPU</span>
          <span className="col-mem">MEM</span>
          <span className="col-uptime">UPTIME</span>
          <span className="col-act">ACTIONS</span>
        </div>

        {/* ─── Body ────────────────────────────────────────────────────── */}
        <div className="ctr-body">
          {/* First load: skeleton rows at the table's own row height. */}
          {groups.length === 0 && loading && containers.length === 0 && (
            <SkeletonRows rows={8} variant="container" />
          )}

          {/* Nothing to list because the engine that would serve it is down. */}
          {groups.length === 0 && !loading && containers.length === 0 && downEngine && (
            <EngineDown
              runtime={downEngine}
              starting={startingEngine}
              onStart={() => startEngine(downEngine)}
            />
          )}

          {groups.length === 0 && !loading && !(containers.length === 0 && downEngine) && (
            <div className="empty">
              <Glyph name="container" size={24} />
              <div>
                {containers.length === 0
                  ? 'No containers yet — run an image to get started.'
                  : 'No containers match this filter.'}
              </div>
              {containers.length === 0 ? (
                <button
                  type="button"
                  className="tool-btn is-primary"
                  onClick={() => setRunOpen(true)}
                >
                  <Glyph name="plus" size={12} sw={2} /> Run container
                </button>
              ) : (
                <button
                  type="button"
                  className="tool-btn"
                  onClick={() => setStatusFilter('all')}
                >
                  Clear filters
                </button>
              )}
            </div>
          )}

          {groups.map((g) => {
            const ids = g.items.map((c) => c.id);
            const up = g.items.filter((c) => c.status === 'running').length;
            const tone = up === g.items.length ? 'ok' : up === 0 ? 'off' : 'part';
            const info = composeStacks[g.key];
            const rep = replicas[g.key] ?? 1;
            const groupSelected = ids.every((id) => selection.includes(id));

            return (
              // Serious renders this wrapper as plain flow; Playful styles it
              // as a standalone outlined card per stack.
              <div className="ctr-stack" key={g.key}>
                <div className="ctr-group">
                  <button
                    type="button"
                    className={`ctr-check ${groupSelected ? 'is-on' : ''}`}
                    aria-label={`Select stack ${g.key}`}
                    onClick={() => toggleSelectedMany(ids)}
                  >
                    {groupSelected && <Glyph name="check" size={10} sw={3} />}
                  </button>
                  <span className={`ctr-group-dot tone-${tone}`} />
                  <span className="ctr-group-name">{g.key}</span>
                  <span className={`ctr-group-chip mono tone-${tone}`}>
                    {up}/{g.items.length} up
                  </span>

                  <div
                    className="ctr-rep"
                    title={
                      info?.services[0]
                        ? `Scale ${info.services[0]}`
                        : 'Needs a compose file for this stack'
                    }
                  >
                    <span className="ctr-rep-label">REPLICAS</span>
                    <button
                      type="button"
                      className="ctr-rep-btn"
                      aria-label="Fewer replicas"
                      disabled={!info?.services.length || rep <= 0}
                      onClick={() => scaleStack(g.key, rep - 1)}
                    >
                      <Glyph name="minus" size={10} sw={2.2} />
                    </button>
                    <span className="ctr-rep-val mono">{rep}</span>
                    <button
                      type="button"
                      className="ctr-rep-btn"
                      aria-label="More replicas"
                      disabled={!info?.services.length || rep >= 9}
                      onClick={() => scaleStack(g.key, rep + 1)}
                    >
                      <Glyph name="plus" size={10} sw={2.2} />
                    </button>
                  </div>

                  <div className="ctr-group-trail">
                    <span className="ctr-group-net mono">
                      {`${g.key}_default`}
                    </span>
                    <button
                      type="button"
                      className="text-btn"
                      title={info?.file ?? 'Choose a compose file'}
                      disabled={!live}
                      onClick={() => openComposeFile(g.key)}
                    >
                      compose.yml
                    </button>
                    <button
                      type="button"
                      className="text-btn"
                      onClick={() => openRow(g.items[0], 'logs')}
                    >
                      logs
                    </button>
                    <div className="ctr-group-btns">
                      <button
                        type="button"
                        className="stack-btn"
                        title="start stack"
                        onClick={() => stackUp(g.key)}
                      >
                        <Glyph name="play" size={9} fill="currentColor" sw={0} />
                        up
                      </button>
                      <button
                        type="button"
                        className="stack-btn is-danger"
                        title="stop stack"
                        onClick={() => stackDown(g.key)}
                      >
                        <Glyph name="stop" size={9} fill="currentColor" sw={0} />
                        down
                      </button>
                      <button
                        type="button"
                        className="stack-icon"
                        title="restart stack"
                        aria-label={`Restart stack ${g.key}`}
                        onClick={() => restartStack(g.key)}
                      >
                        <Glyph name="restart" size={11} sw={1.8} />
                      </button>
                    </div>
                  </div>
                </div>

                {/* Per-stack column strip — Playful only; Serious uses the
                    single header above the body. */}
                <div className="ctr-stack-thead mono" aria-hidden="true">
                  <span className="ctr-check-spacer" />
                  <span className="col-name">NAME</span>
                  <span className="col-image">IMAGE</span>
                  <span className="col-ports">PORTS</span>
                  <span className="col-cpu">CPU</span>
                  <span className="col-mem">MEM</span>
                  <span className="col-uptime">UPTIME</span>
                  <span className="col-act">ACTIONS</span>
                </div>

                {g.items.map((c) => {
                  const selected = selection.includes(c.id);
                  const isRunning = c.status === 'running';
                  const isPaused = c.status === 'paused';
                  return (
                    <div
                      key={c.id}
                      className={`ctr-row ${focusedContainer === c.id ? 'is-focused' : ''}`}
                      onClick={() => openRow(c)}
                    >
                      <button
                        type="button"
                        className={`ctr-check ${selected ? 'is-on' : ''}`}
                        aria-label={`Select ${c.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleSelected(c.id);
                        }}
                      >
                        {selected && <Glyph name="check" size={10} sw={3} />}
                      </button>

                      <div className="col-name">
                        <span className={`ctr-dot st-${c.status}`} />
                        <span className="ctr-name">{c.name}</span>
                        <span className="ctr-id mono">{c.id}</span>
                        <span
                          className="ctr-rt"
                          title={c.rt}
                          style={{ background: RUNTIMES[c.rt]?.accent }}
                        />
                      </div>

                      <span className="col-image mono">{c.image}</span>
                      <PortsCell raw={c.port} />

                      <div className="col-cpu">
                        <div className="ctr-bar">
                          <div
                            className={`ctr-bar-fill st-${c.status}`}
                            style={{ width: `${Math.min(c.cpu * 8, 100)}%` }}
                          />
                        </div>
                        <span className="ctr-cpu-val mono">{c.cpu.toFixed(1)}%</span>
                      </div>

                      <span className="col-mem mono">{c.mem ? `${c.mem}M` : '—'}</span>
                      <span className="col-uptime mono">{c.uptime}</span>

                      <div className="col-act" onClick={(e) => e.stopPropagation()}>
                        {/* A paused container is still live, so its primary
                            action is Stop — leaving the play glyph to mean
                            unpause on the button beside it. */}
                        <button
                          type="button"
                          className="row-btn"
                          title={c.status === 'stopped' ? 'Start' : 'Stop'}
                          onClick={() =>
                            setContainerStatus(
                              c.id,
                              c.status === 'stopped' ? 'running' : 'stopped',
                            )
                          }
                        >
                          <Glyph
                            name={c.status === 'stopped' ? 'play' : 'stop'}
                            size={10}
                            fill="currentColor"
                            sw={0}
                          />
                        </button>
                        <button
                          type="button"
                          className="row-btn"
                          title={isPaused ? 'Unpause' : 'Pause'}
                          disabled={!isRunning && !isPaused}
                          onClick={() => toggleRunPause(c.id)}
                        >
                          <Glyph
                            name={isPaused ? 'play' : 'pause'}
                            size={10}
                            fill="currentColor"
                            sw={0}
                          />
                        </button>
                        <button
                          type="button"
                          className="row-btn"
                          title="Restart"
                          onClick={() => restartContainer(c.id)}
                        >
                          <Glyph name="restart" size={12} sw={1.8} />
                        </button>
                        <button
                          type="button"
                          className="row-btn"
                          title="Shell"
                          onClick={() => openRow(c, 'shell')}
                        >
                          <Glyph name="terminal" size={12} />
                        </button>
                        <button
                          type="button"
                          className="row-btn is-danger"
                          title="Remove"
                          onClick={() => removeContainer(c.id)}
                        >
                          <Glyph name="trash" size={12} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>

        {/* ─── Selection bar ───────────────────────────────────────────── */}
        {selection.length > 0 && (
          <div className="ctr-selbar">
            <span className="ctr-selbar-n">{selection.length} selected</span>
            <span className="ctr-selbar-names mono">{selectedNames}</span>
            <div className="ctr-selbar-div" />
            <button
              type="button"
              className="sel-btn"
              onClick={() => actOnSelection('start')}
            >
              Start
            </button>
            <button
              type="button"
              className="sel-btn"
              onClick={() => actOnSelection('stop')}
            >
              Stop
            </button>
            <button
              type="button"
              className="sel-btn"
              onClick={() => actOnSelection('restart')}
            >
              Restart
            </button>
            <button
              type="button"
              className="sel-btn is-danger"
              onClick={() => setConfirm('remove-selection')}
            >
              Remove
            </button>
            <button type="button" className="ctr-selbar-clear" onClick={clearSelection}>
              Clear
            </button>
          </div>
        )}
      </div>

      {focused && (
        <ContainerDetailPane
          container={focused}
          width={paneWidth}
          tab={detailTab}
          onTab={setDetailTab}
          onClose={() => setFocusedContainer(null)}
          onStartResize={startResize}
        />
      )}

      {runOpen && (
        <RunContainerModal
          defaultRuntime={runtimeFilter === 'podman' ? 'podman' : 'docker'}
          onClose={() => setRunOpen(false)}
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
      {confirm === 'stop-all' && (
        <ConfirmDialog
          title="Stop all running containers?"
          body={`${runningCount} container${runningCount === 1 ? '' : 's'} will be stopped. Compose stacks stay defined — this does not remove anything.`}
          confirmLabel={`Stop ${runningCount}`}
          onConfirm={stopAllRunning}
          onClose={() => setConfirm(null)}
        />
      )}
      {confirm === 'remove-selection' && (
        <ConfirmDialog
          title="Remove selected containers?"
          body={`${selection.length} container${selection.length === 1 ? '' : 's'} will be removed. This cannot be undone.`}
          confirmLabel={`Remove ${selection.length}`}
          onConfirm={() => actOnSelection('remove')}
          onClose={() => setConfirm(null)}
        />
      )}
    </div>
  );
}
