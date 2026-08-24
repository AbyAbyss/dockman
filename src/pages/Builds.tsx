// Builds — new-build form, history, layer waterfall and an editable Dockerfile
// viewer beside a facts pane.
//
// Under Tauri a build streams real `docker build` output over events and the
// finished record lands in the persisted history; in the browser the flow is
// simulated and kept in local state.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Glyph } from '@/components/ui/Icon';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useAppStore } from '@/store/appStore';
import { useBuilds } from '@/hooks/useData';
import { BuildCommands, buildOutputEvent, BUILDS_CHANGED } from '@/lib/commands';
import { listen, type UnlistenFn } from '@/lib/tauri';
import { LAYER_CACHE, RUNTIMES } from '@/data/seed';
import type { BuildLayer, BuildRecord, RuntimeName } from '@/types';

const INSTRUCTIONS = new Set([
  'FROM', 'RUN', 'CMD', 'LABEL', 'EXPOSE', 'ENV', 'ADD', 'COPY', 'ENTRYPOINT',
  'VOLUME', 'USER', 'WORKDIR', 'ARG', 'ONBUILD', 'STOPSIGNAL', 'HEALTHCHECK', 'SHELL',
]);

const DEFAULT_DOCKERFILE = `# syntax=docker/dockerfile:1.7
FROM node:20-bookworm AS builder
WORKDIR /app
COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm \\
    npm ci --omit=dev
COPY src ./src
RUN npm run build

FROM gcr.io/distroless/nodejs20-debian12
COPY --from=builder /app/dist /app
WORKDIR /app
EXPOSE 8080
CMD ["server.js"]
`;

const SIM_LINES = [
  'building image — streaming docker buildx output',
  '#1 [internal] load build definition from Dockerfile',
  '#2 [internal] load metadata for node:20-bookworm',
  '#3 [builder 1/6] FROM node:20-bookworm',
  '#4 [builder 2/6] COPY package*.json ./',
  '#5 [builder 3/6] RUN npm ci --omit=dev',
  '#6 [builder 4/6] RUN npm run build',
  '#7 exporting layers',
  '#8 writing image sha256:a3f1c0…  done',
];

function parseLayers(dockerfile: string, cachePercent: number): BuildLayer[] {
  const steps = dockerfile
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#') && INSTRUCTIONS.has(l.split(/\s+/)[0]));
  const cachedCount = Math.round((steps.length * cachePercent) / 100);
  return steps.map((instruction, i) => ({
    step: i + 1,
    instruction,
    cached: i < cachedCount,
    durationMs: i < cachedCount ? 120 + ((i * 53) % 420) : 1100 + ((i * 317) % 4200),
  }));
}

interface BuildTask {
  id?: string;
  progress: number;
  lines: string[];
}

function DockerfileView({ text }: { text: string }) {
  const lines = text.replace(/\n$/, '').split('\n');
  return (
    <pre className="dockerfile">
      {lines.map((line, i) => {
        const isComment = line.trim().startsWith('#');
        const firstWord = line.trim().split(/\s+/)[0];
        const isKw = !isComment && INSTRUCTIONS.has(firstWord);
        return (
          <div key={i} className={`df-line ${isComment ? 'is-comment' : ''}`}>
            <span className="df-num">{i + 1}</span>
            {isKw ? (
              <>
                <span className="df-kw">{firstWord}</span>
                <span>{line.slice(line.indexOf(firstWord) + firstWord.length)}</span>
              </>
            ) : (
              <>
                <span />
                <span>{line}</span>
              </>
            )}
          </div>
        );
      })}
    </pre>
  );
}

/** A checkbox drawn as a 15px accent box, matching the design's controls. */
function Check({
  on,
  label,
  onToggle,
}: {
  on: boolean;
  label: string;
  onToggle: () => void;
}) {
  return (
    <button type="button" className="check-row" onClick={onToggle} aria-pressed={on}>
      <span className={`check-box ${on ? 'is-on' : ''}`}>
        {on && <Glyph name="check" size={10} sw={3} />}
      </span>
      {label}
    </button>
  );
}

export default function Builds() {
  const runtimeFilter = useAppStore((s) => s.runtimeFilter);
  const selectedBuild = useAppStore((s) => s.selectedBuild);
  const setSelectedBuild = useAppStore((s) => s.setSelectedBuild);
  const buildsRes = useBuilds(runtimeFilter);

  const [localBuilds, setLocalBuilds] = useState<BuildRecord[]>([]);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [task, setTask] = useState<BuildTask | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [form, setForm] = useState({
    tag: 'dockman/api-gw:0.14.3',
    context: '~/work/api-platform',
    useCache: true,
    pushOnSuccess: false,
  });
  const timer = useRef<number | null>(null);
  const unlisteners = useRef<UnlistenFn[]>([]);

  useEffect(
    () => () => {
      if (timer.current) clearInterval(timer.current);
      unlisteners.current.forEach((u) => u());
    },
    [],
  );

  const builds = useMemo(
    () =>
      [...localBuilds, ...buildsRes.data].filter(
        (b) => runtimeFilter === 'all' || b.rt === runtimeFilter,
      ),
    [localBuilds, buildsRes.data, runtimeFilter],
  );

  const selected = builds.find((b) => b.id === selectedBuild) || builds[0];
  const dockerfile = selected ? overrides[selected.id] ?? selected.dockerfile : '';
  const successCount = builds.filter((b) => b.status === 'success').length;

  const layers = selected?.layers ?? [];
  const maxLayerMs = Math.max(1, ...layers.map((l) => l.durationMs));
  // On a failed build the step after the last cached one is the failure point.
  const failedAt =
    selected?.status === 'failed'
      ? layers.findIndex((l) => !l.cached)
      : -1;

  const startEdit = () => {
    if (!selected) return;
    setDraft(dockerfile);
    setEditing(true);
  };

  const saveEdit = () => {
    if (!selected) return;
    setOverrides((o) => ({ ...o, [selected.id]: draft }));
    setEditing(false);
  };

  const startBuild = async () => {
    if (task) return;

    if (buildsRes.live) {
      setTask({ progress: 8, lines: ['queued build — invoking docker build…'] });
      try {
        const id = await BuildCommands.start({
          runtime: runtimeFilter === 'podman' ? 'podman' : 'docker',
          tag: form.tag,
          contextPath: form.context,
          buildArgs: [],
          useCache: form.useCache,
          pushOnSuccess: form.pushOnSuccess,
        });
        setTask((t) => (t ? { ...t, id } : t));
        const offOutput = await listen<string>(buildOutputEvent(id), (line) => {
          setTask((t) =>
            t ? { ...t, progress: Math.min(95, t.progress + 3), lines: [...t.lines, line] } : t,
          );
        });
        const offDone = await listen<unknown>(BUILDS_CHANGED, () => {
          offOutput();
          offDone();
          unlisteners.current = unlisteners.current.filter(
            (u) => u !== offOutput && u !== offDone,
          );
          setTask(null);
          setSelectedBuild(id);
          buildsRes.refetch();
        });
        unlisteners.current.push(offOutput, offDone);
      } catch {
        setTask(null);
      }
      return;
    }

    // Browser simulation.
    setTask({ progress: 0, lines: [SIM_LINES[0]] });
    let i = 1;
    timer.current = window.setInterval(() => {
      if (i < SIM_LINES.length) {
        const idx = i;
        setTask((t) =>
          t
            ? {
                ...t,
                progress: Math.round((idx / SIM_LINES.length) * 100),
                lines: [...t.lines, SIM_LINES[idx]],
              }
            : t,
        );
        i += 1;
        return;
      }
      if (timer.current) clearInterval(timer.current);
      timer.current = null;
      const cachePercent = form.useCache ? 90 : 0;
      const built = parseLayers(DEFAULT_DOCKERFILE, cachePercent);
      const record: BuildRecord = {
        id: `b-${Date.now().toString(36)}`,
        rt: (runtimeFilter === 'podman' ? 'podman' : 'docker') as RuntimeName,
        tag: form.tag,
        status: 'success',
        when: 'just now',
        duration: `${9 + Math.floor(Math.random() * 14)}s`,
        cachePercent,
        size: '142 MB',
        finalSize: '142 MB',
        layerCount: built.length,
        dockerfile: DEFAULT_DOCKERFILE,
        layers: built,
      };
      setLocalBuilds((bs) => [record, ...bs]);
      setSelectedBuild(record.id);
      setEditing(false);
      setTask(null);
    }, 430);
  };

  // Backend commands the previous build had no UI for.
  const cancelBuild = () => {
    if (task?.id) BuildCommands.cancel(task.id).catch(() => undefined);
    if (timer.current) {
      clearInterval(timer.current);
      timer.current = null;
    }
    setTask(null);
  };

  const deleteBuild = (id: string) => {
    setLocalBuilds((bs) => bs.filter((b) => b.id !== id));
    BuildCommands.remove(id)
      .then(() => buildsRes.refetch())
      .catch(() => undefined);
    if (selectedBuild === id) setSelectedBuild('');
  };

  const clearHistory = () => {
    setLocalBuilds([]);
    setSelectedBuild('');
    BuildCommands.clearHistory()
      .then(() => buildsRes.refetch())
      .catch(() => undefined);
  };

  return (
    <div className="split-screen">
      <div className="split-main split-scroll">
        <div className="screen-pad">
          {/* ─── New build ────────────────────────────────────────────── */}
          <div className="card build-form">
            <div className="build-form-row">
              <span className="card-title">New build</span>
              <input
                className="field mono build-tag"
                value={form.tag}
                placeholder="repo/name:tag"
                onChange={(e) => setForm({ ...form, tag: e.target.value })}
              />
              <input
                className="field mono build-context"
                value={form.context}
                placeholder="build context"
                onChange={(e) => setForm({ ...form, context: e.target.value })}
              />
              {task ? (
                <button type="button" className="tool-btn is-danger" onClick={cancelBuild}>
                  <Glyph name="close" size={12} sw={1.8} />
                  Cancel
                </button>
              ) : (
                <button type="button" className="tool-btn is-primary" onClick={startBuild}>
                  <Glyph name="build" size={12} sw={1.7} />
                  Build
                </button>
              )}
            </div>
            <div className="build-form-row build-opts">
              <Check
                on={form.useCache}
                label="Use layer cache"
                onToggle={() => setForm({ ...form, useCache: !form.useCache })}
              />
              <Check
                on={form.pushOnSuccess}
                label="Push to registry on success"
                onToggle={() => setForm({ ...form, pushOnSuccess: !form.pushOnSuccess })}
              />
              <Check
                on={!form.useCache}
                label="No cache"
                onToggle={() => setForm({ ...form, useCache: !form.useCache })}
              />
              <span className="toolbar-note mono">
                cache {LAYER_CACHE.totalSize} · {LAYER_CACHE.cachedLayers} layers
              </span>
            </div>
            {task && (
              <div className="build-task">
                <div className="track">
                  <div className="track-fill" style={{ width: `${task.progress}%` }} />
                </div>
                <div className="build-log mono">
                  {task.lines.slice(-6).map((l, i) => (
                    <div key={i}>{l}</div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* ─── History ──────────────────────────────────────────────── */}
          <div className="card card-flush-p">
            <div className="ov-card-head build-head">
              <span className="card-title">Recent builds</span>
              <span className="toolbar-note mono">
                {builds.length} · {successCount} succeeded
              </span>
              <button
                type="button"
                className="text-btn"
                disabled={builds.length === 0}
                onClick={() => setConfirmClear(true)}
              >
                clear history
              </button>
            </div>
            <div className="build-list">
              {builds.length === 0 && (
                <div className="empty">
                  <Glyph name="build" size={24} />
                  <div>No builds yet.</div>
                </div>
              )}
              {builds.map((b) => (
                <div
                  key={b.id}
                  className={`build-row ${selected?.id === b.id ? 'is-focused' : ''}`}
                  onClick={() => {
                    setSelectedBuild(b.id);
                    setEditing(false);
                  }}
                >
                  <span className={`ctr-dot st-${b.status === 'failed' ? 'bad' : 'running'}`} />
                  <span className="build-tag-cell mono">{b.tag}</span>
                  <span
                    className="ctr-rt"
                    title={b.rt}
                    style={{ background: RUNTIMES[b.rt]?.accent }}
                  />
                  <span className="build-when mono">{b.when}</span>
                  <span className="build-dur mono">{b.duration}</span>
                  <div className="build-cache">
                    <div className="track">
                      <div className="track-fill" style={{ width: `${b.cachePercent}%` }} />
                    </div>
                    <span className="mono">{b.cachePercent}%</span>
                  </div>
                  <span className="build-size mono">{b.size}</span>
                  <span className={`build-status tone-${b.status}`}>{b.status}</span>
                  <button
                    type="button"
                    className="row-btn is-danger"
                    title="Delete build record"
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteBuild(b.id);
                    }}
                  >
                    <Glyph name="trash" size={12} />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* ─── Layer waterfall ──────────────────────────────────────── */}
          {selected && (
            <div className="card">
              <div className="ov-card-head">
                <span className="card-title">Layer waterfall</span>
                <span className="toolbar-note mono">{selected.tag}</span>
              </div>
              <div className="layer-list">
                {layers.map((l, i) => {
                  const failed = i === failedAt;
                  return (
                    <div key={l.step} className="layer-row">
                      <span className="layer-step mono">{l.step}</span>
                      <span className="layer-inst mono">{l.instruction}</span>
                      <div className="layer-track">
                        <div
                          className={`layer-fill ${l.cached ? 'is-cached' : ''} ${failed ? 'is-failed' : ''}`}
                          style={{ width: `${(l.durationMs / maxLayerMs) * 100}%` }}
                        />
                      </div>
                      <span className="layer-dur mono">
                        {failed ? 'error' : `${(l.durationMs / 1000).toFixed(1)}s`}
                      </span>
                      <span
                        className={`layer-tag mono ${failed ? 'is-failed' : l.cached ? 'is-cached' : 'is-ran'}`}
                      >
                        {failed ? 'FAILED' : l.cached ? 'CACHED' : 'RAN'}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ─── Right pane ────────────────────────────────────────────────── */}
      <aside className="side-pane">
        {selected ? (
          <>
            <div className="side-block">
              <div className="side-title mono">{selected.tag}</div>
              <div className="fact-grid">
                {[
                  { k: 'DURATION', v: selected.duration, bad: false },
                  { k: 'LAYERS', v: String(selected.layerCount), bad: false },
                  { k: 'CACHE HIT', v: `${selected.cachePercent}%`, bad: false },
                  {
                    k: 'FINAL SIZE',
                    v: selected.finalSize,
                    bad: selected.status === 'failed',
                  },
                ].map((f) => (
                  <div key={f.k} className="fact">
                    <div className="section-label">{f.k}</div>
                    <div className={`fact-v ${f.bad ? 'is-bad' : ''}`}>{f.v}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="side-block df-block">
              <div className="snap-head">
                <span className="section-label">DOCKERFILE</span>
                {editing ? (
                  <button type="button" className="text-btn" onClick={saveEdit}>
                    save
                  </button>
                ) : (
                  <button type="button" className="text-btn" onClick={startEdit}>
                    edit
                  </button>
                )}
              </div>
              {editing ? (
                <textarea
                  className="df-edit mono"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                />
              ) : (
                <DockerfileView text={dockerfile} />
              )}
            </div>
          </>
        ) : (
          <div className="det-empty mono">select a build</div>
        )}
      </aside>

      {confirmClear && (
        <ConfirmDialog
          title="Clear build history?"
          body={`All ${builds.length} build records will be removed. The images they produced are not affected.`}
          confirmLabel="Clear"
          onConfirm={clearHistory}
          onClose={() => setConfirmClear(false)}
        />
      )}
    </div>
  );
}
