// Builds — image build history, layer waterfall, an editable Dockerfile
// viewer and the shared layer cache.
//
// Under Tauri a build streams real `docker build` output over events and the
// finished record lands in the persisted history; in the browser the flow is
// simulated and kept in local state.

import { useEffect, useMemo, useRef, useState } from 'react';
import { BentoCard } from '@/components/ui/BentoCard';
import { StatTile } from '@/components/ui/StatTile';
import { Glyph } from '@/components/ui/Icon';
import { Pill, StatusDot } from '@/components/ui/Badge';
import { ACCENTS, useThemeStore } from '@/store/themeStore';
import { useAppStore } from '@/store/appStore';
import { useBuilds } from '@/hooks/useData';
import { BuildCommands, buildOutputEvent, BUILDS_CHANGED } from '@/lib/commands';
import { listen, type UnlistenFn } from '@/lib/tauri';
import { LAYER_CACHE } from '@/data/seed';
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

export default function Builds() {
  const accent = ACCENTS[useThemeStore((s) => s.accent)].hex;
  const runtimeFilter = useAppStore((s) => s.runtimeFilter);
  const buildsRes = useBuilds(runtimeFilter);

  const [localBuilds, setLocalBuilds] = useState<BuildRecord[]>([]);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [selectedId, setSelectedId] = useState<string>('');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [task, setTask] = useState<BuildTask | null>(null);
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

  const selected = builds.find((b) => b.id === selectedId) || builds[0];
  const dockerfile = selected
    ? overrides[selected.id] ?? selected.dockerfile
    : '';

  const successCount = builds.filter((b) => b.status === 'success').length;
  const avgCache = builds.length
    ? Math.round(builds.reduce((s, b) => s + b.cachePercent, 0) / builds.length)
    : 0;

  const selectBuild = (id: string) => {
    setSelectedId(id);
    setEditing(false);
  };

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
        const offOutput = await listen<string>(buildOutputEvent(id), (line) => {
          setTask((t) =>
            t ? { progress: Math.min(95, t.progress + 3), lines: [...t.lines, line] } : t,
          );
        });
        const offDone = await listen<unknown>(BUILDS_CHANGED, () => {
          offOutput();
          offDone();
          unlisteners.current = unlisteners.current.filter(
            (u) => u !== offOutput && u !== offDone,
          );
          setTask(null);
          setSelectedId(id);
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
      const layers = parseLayers(DEFAULT_DOCKERFILE, cachePercent);
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
        layerCount: layers.length,
        dockerfile: DEFAULT_DOCKERFILE,
        layers,
      };
      setLocalBuilds((bs) => [record, ...bs]);
      setSelectedId(record.id);
      setEditing(false);
      setTask(null);
    }, 430);
  };

  const maxDur = selected
    ? Math.max(...selected.layers.map((l) => l.durationMs), 1)
    : 1;

  return (
    <div className="bento">
      <div className="stat-trio" style={{ gridColumn: 'span 5' }}>
        <StatTile value={builds.length} label="Total builds" section="History" sectionIcon="build" tone="violet" />
        <StatTile value={successCount} label="Succeeded" section="Passed" sectionIcon="bolt" tone="default" suffix="" />
        <StatTile value={avgCache} label="Avg cache hit" section="Reuse" sectionIcon="disk" tone="default" suffix="%" />
      </div>

      <BentoCard section="Pipeline" sectionIcon="build" title="New Build" span={7} headerAlign="left">
        <div className="build-action">
          <div className="build-form">
            <div className="pull-input">
              <Glyph name="image" size={13} />
              <input
                value={form.tag}
                onChange={(e) => setForm({ ...form, tag: e.target.value })}
                placeholder="image:tag"
              />
            </div>
            <div className="pull-input">
              <Glyph name="volume" size={13} />
              <input
                value={form.context}
                onChange={(e) => setForm({ ...form, context: e.target.value })}
                placeholder="build context path"
              />
            </div>
            <button className="action-btn primary" type="button" onClick={startBuild} disabled={!!task}>
              {task ? `${task.progress}%` : (
                <>
                  <Glyph name="build" size={12} /> Build
                </>
              )}
            </button>
          </div>

          {task ? (
            <div className="build-progress">
              <div className="pull-bar">
                <div className="pull-fill" style={{ width: `${task.progress}%` }} />
              </div>
              <div className="build-log">
                {task.lines.map((l, i) => (
                  <div key={i}>{l}</div>
                ))}
              </div>
            </div>
          ) : (
            <div className="build-options">
              <label className="opt-row">
                <input
                  type="checkbox"
                  checked={form.useCache}
                  onChange={(e) => setForm({ ...form, useCache: e.target.checked })}
                />
                Use layer cache — skip unchanged steps
              </label>
              <label className="opt-row">
                <input
                  type="checkbox"
                  checked={form.pushOnSuccess}
                  onChange={(e) => setForm({ ...form, pushOnSuccess: e.target.checked })}
                />
                Push to registry on success
              </label>
            </div>
          )}
        </div>
      </BentoCard>

      <BentoCard section="Cache" sectionIcon="disk" title="Layer Cache" span={5} headerAlign="left">
        <div className="cache-summary">
          <div className="cache-summary-val">{LAYER_CACHE.totalSize}</div>
          <div className="cache-summary-sub mono">
            across {LAYER_CACHE.cachedLayers} cached layers
          </div>
        </div>
        <div className="pill-grid">
          {LAYER_CACHE.images.map((img) => (
            <div key={img.name} className="pill-btn">
              <span className="pb-icon">
                <Glyph name="image" size={13} />
              </span>
              <span className="pb-text">
                <span className="pb-label">{img.name}</span>
                <span className="pb-sub mono">{img.layers} layers</span>
              </span>
            </div>
          ))}
        </div>
      </BentoCard>

      <BentoCard
        section="History"
        sectionIcon="build"
        title={`Recent Builds · ${builds.length}`}
        span={5}
        headerAlign="left"
      >
        <div className="build-list">
          {builds.map((b) => (
            <button
              key={b.id}
              type="button"
              className={`build-row ${selected && selected.id === b.id ? 'is-on' : ''}`}
              onClick={() => selectBuild(b.id)}
            >
              <StatusDot status={b.status} />
              <div className="build-row-body">
                <div className="build-row-name mono">{b.tag}</div>
                <div className="build-row-meta mono">
                  {b.when} · {b.duration} · {b.cachePercent}% cache
                </div>
              </div>
              <div className="build-row-tail">
                <span className="build-size mono">{b.size}</span>
                <Pill tone={b.status === 'success' ? 'ok' : 'bad'}>{b.status}</Pill>
              </div>
            </button>
          ))}
          {builds.length === 0 && (
            <div className="empty">
              <Glyph name="build" size={24} />
              <div>{buildsRes.loading ? 'Loading builds…' : 'No builds yet.'}</div>
            </div>
          )}
        </div>
      </BentoCard>

      <BentoCard
        section="Detail"
        sectionIcon="build"
        title={selected ? selected.tag : 'Build Detail'}
        span={7}
        headerAlign="left"
      >
        {selected ? (
          <div className="build-detail">
            <div className="build-meta-row">
              <div className="build-meta-cell">
                <div className="bc-section">
                  <span>Duration</span>
                </div>
                <div className="build-meta-val">{selected.duration}</div>
              </div>
              <div className="build-meta-cell">
                <div className="bc-section">
                  <span>Layers</span>
                </div>
                <div className="build-meta-val">{selected.layerCount}</div>
              </div>
              <div className="build-meta-cell">
                <div className="bc-section">
                  <span>Cache hit</span>
                </div>
                <div className="build-meta-val">{selected.cachePercent}%</div>
              </div>
              <div className="build-meta-cell">
                <div className="bc-section">
                  <span>Final size</span>
                </div>
                <div className="build-meta-val">{selected.finalSize}</div>
              </div>
            </div>

            {selected.status === 'failed' && (
              <div className="build-fail">
                <div className="bc-section">
                  <span>Build failed</span>
                </div>
                <div className="build-fail-msg mono">
                  process "/bin/sh -c npm run build" exited with code 1 — check the
                  RUN step output
                </div>
              </div>
            )}

            <div>
              <div className="bc-section" style={{ marginBottom: 8 }}>
                <Glyph name="bolt" size={11} />
                <span>Layer waterfall</span>
              </div>
              <div className="layer-stack">
                {selected.layers.map((l) => (
                  <div key={l.step} className="layer-bar-row">
                    <span className="layer-i mono">
                      {String(l.step).padStart(2, '0')}
                    </span>
                    <span className="layer-bar">
                      <span
                        className="layer-bar-fill"
                        style={{
                          width: `${(l.durationMs / maxDur) * 100}%`,
                          background: l.cached
                            ? 'color-mix(in oklab, var(--accent) 32%, var(--bg))'
                            : accent,
                        }}
                      />
                    </span>
                    <span className="layer-bar-meta mono">
                      {l.cached ? 'CACHED' : `${(l.durationMs / 1000).toFixed(1)}s`}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="empty">
            <Glyph name="build" size={24} />
            <div>Select a build to inspect.</div>
          </div>
        )}
      </BentoCard>

      <BentoCard
        section="Source"
        sectionIcon="command"
        title="Dockerfile"
        span={12}
        headerAlign="left"
        headerAside={
          selected ? (
            editing ? (
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="action-btn" type="button" onClick={() => setEditing(false)}>
                  Cancel
                </button>
                <button className="action-btn primary" type="button" onClick={saveEdit}>
                  <Glyph name="bolt" size={12} /> Save
                </button>
              </div>
            ) : (
              <button className="action-btn" type="button" onClick={startEdit}>
                <Glyph name="build" size={12} /> Edit
              </button>
            )
          ) : undefined
        }
      >
        {selected ? (
          editing ? (
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              spellCheck={false}
              style={{
                width: '100%',
                minHeight: 340,
                fontFamily: 'var(--mono)',
                fontSize: 11,
                lineHeight: 1.7,
                background: 'var(--bg)',
                color: 'var(--text)',
                border: '0.5px solid var(--accent)',
                borderRadius: 10,
                padding: '12px 14px',
                resize: 'vertical',
                outline: 'none',
              }}
            />
          ) : (
            <DockerfileView text={dockerfile} />
          )
        ) : (
          <div className="empty">
            <Glyph name="command" size={24} />
            <div>No Dockerfile to show.</div>
          </div>
        )}
      </BentoCard>
    </div>
  );
}
