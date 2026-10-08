// Builds — run `docker build` / `podman build`, keep a history with the
// step timings the CLI reported, inspect the Dockerfile and edit it in place.

import { useEffect, useRef, useState } from 'react';
import { BentoCard } from '@/components/ui/BentoCard';
import { StatTile } from '@/components/ui/StatTile';
import { Glyph } from '@/components/ui/Icon';
import { Pill, StatusDot } from '@/components/ui/Badge';
import { RuntimeBadge } from '@/components/ui/Runtime';
import { ACCENTS, useThemeStore } from '@/store/themeStore';
import { useAppStore } from '@/store/appStore';
import { logActivity } from '@/store/activityStore';
import { useBuilds, useRuntimes, useSystemDf } from '@/hooks/useData';
import {
  BuildCommands,
  HostCommands,
  buildOutputEvent,
  BUILDS_CHANGED,
} from '@/lib/commands';
import { fallbackPlatform, isArchMismatch } from '@/lib/archFallback';
import { formatBytes } from '@/lib/parsers';
import { listen, type UnlistenFn } from '@/lib/tauri';
import type { RuntimeName } from '@/types';

const INSTRUCTIONS = new Set([
  'FROM', 'RUN', 'CMD', 'LABEL', 'EXPOSE', 'ENV', 'ADD', 'COPY', 'ENTRYPOINT',
  'VOLUME', 'USER', 'WORKDIR', 'ARG', 'ONBUILD', 'STOPSIGNAL', 'HEALTHCHECK', 'SHELL',
]);

const DF_LABEL: Record<string, string> = {
  images: 'Images',
  containers: 'Containers',
  volumes: 'Volumes',
  build_cache: 'Build cache',
  other: 'Other',
};

interface BuildTask {
  id: string | null;
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
  const df = useSystemDf(runtimeFilter, 30000);
  const autoFallback = useThemeStore((s) => s.m1Fallback);
  const { runtimes } = useRuntimes();

  const [selectedId, setSelectedId] = useState<string>('');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [task, setTask] = useState<BuildTask | null>(null);
  /** Note under the build form; `platform` offers a Docker rebuild. */
  const [buildHint, setBuildHint] = useState<{ text: string; platform?: string } | null>(null);
  const [form, setForm] = useState({
    tag: '',
    context: '',
    dockerfile: '',
    useCache: true,
    pushOnSuccess: false,
  });
  const unlisteners = useRef<UnlistenFn[]>([]);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(
    () => () => {
      unlisteners.current.forEach((u) => u());
    },
    [],
  );

  // Keep the build log scrolled to the newest line.
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [task?.lines.length]);

  const builds = buildsRes.data;
  const selected = builds.find((b) => b.id === selectedId) || builds[0];
  const dockerfile = selected?.dockerfile ?? '';

  const successCount = builds.filter((b) => b.status === 'success').length;
  const avgCache = builds.length
    ? Math.round(builds.reduce((s, b) => s + b.cachePercent, 0) / builds.length)
    : 0;

  const selectBuild = (id: string) => {
    setSelectedId(id);
    setEditing(false);
    setSaveMsg(null);
  };

  const startEdit = () => {
    if (!selected) return;
    setDraft(dockerfile);
    setEditing(true);
  };

  const saveEdit = () => {
    if (!selected) return;
    BuildCommands.saveDockerfile(selected.id, draft)
      .then(() => {
        setSaveMsg(`Saved to ${selected.dockerfilePath}`);
        setEditing(false);
        buildsRes.refetch();
      })
      .catch((e) => setSaveMsg(String(e)));
  };

  const pickContext = () => {
    HostCommands.pickDirectory()
      .then((dir) => {
        if (dir) setForm((f) => ({ ...f, context: dir }));
      })
      .catch(() => undefined);
  };

  const runBuild = async (runtime: RuntimeName, platform?: string) => {
    setTask({ id: null, lines: [`$ ${runtime} build -t ${form.tag} ${form.context}`] });
    const output: string[] = [];
    try {
      const id = await BuildCommands.start({
        runtime,
        tag: form.tag.trim(),
        contextPath: form.context.trim(),
        dockerfile: form.dockerfile.trim() || undefined,
        buildArgs: [],
        platform,
        useCache: form.useCache,
        pushOnSuccess: form.pushOnSuccess,
      });
      setTask((t) => (t ? { ...t, id } : t));
      const offOutput = await listen<string>(buildOutputEvent(id), (line) => {
        output.push(line);
        setTask((t) => (t ? { ...t, lines: [...t.lines, line] } : t));
      });
      const offDone = await listen<unknown>(BUILDS_CHANGED, async () => {
        offOutput();
        offDone();
        unlisteners.current = unlisteners.current.filter(
          (u) => u !== offOutput && u !== offDone,
        );
        setSelectedId(id);
        buildsRes.refetch();
        df.refetch();

        const rec = (await BuildCommands.list().catch(() => [])).find((b) => b.id === id);
        logActivity(
          rec?.status === 'success' ? 'build' : 'error',
          runtime,
          form.tag.trim(),
          rec?.status === 'success' ? `${rec.duration} · ${rec.finalSize}` : rec?.error || 'build failed',
        );

        // A Podman build that failed on the CPU architecture (a base image
        // with no variant for this host, or a RUN step hitting "exec format
        // error") can be rebuilt on Docker for the foreign platform.
        if (
          rec?.status === 'failed' &&
          runtime === 'podman' &&
          runtimes.docker.found &&
          isArchMismatch(output.join('\n'))
        ) {
          const plat = fallbackPlatform(runtimes.docker.arch);
          logActivity('fallback', 'podman', form.tag.trim(), `arch mismatch, docker ${plat}`);
          if (autoFallback) {
            setBuildHint({ text: `Arch mismatch on podman, rebuilding on docker (${plat})` });
            runBuild('docker', plat);
            return;
          }
          setBuildHint({
            text: "Podman couldn't build this image for its CPU architecture.",
            platform: plat,
          });
        }
        setTask(null);
      });
      unlisteners.current.push(offOutput, offDone);
    } catch (e) {
      setTask(null);
      setBuildHint({ text: String(e) });
    }
  };

  const startBuild = () => {
    if (task) return;
    setBuildHint(null);
    void runBuild(runtimeFilter === 'podman' ? 'podman' : 'docker');
  };

  const cancelBuild = () => {
    if (!task?.id) return;
    BuildCommands.cancel(task.id).catch(() => undefined);
  };

  const removeBuild = (id: string) => {
    BuildCommands.remove(id)
      .then(() => buildsRes.refetch())
      .catch(() => undefined);
  };

  const maxDur = selected
    ? Math.max(...selected.layers.map((l) => l.durationMs), 1)
    : 1;
  const canBuild = !task && form.tag.trim() !== '' && form.context.trim() !== '';

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
                placeholder="build context folder (contains the Dockerfile)"
              />
              <button className="text-btn" type="button" onClick={pickContext}>
                browse
              </button>
            </div>
            {task ? (
              <button className="action-btn danger" type="button" onClick={cancelBuild} disabled={!task.id}>
                <Glyph name="stop" size={12} /> Cancel
              </button>
            ) : (
              <button className="action-btn primary" type="button" onClick={startBuild} disabled={!canBuild}>
                <Glyph name="build" size={12} /> Build on {runtimeFilter === 'podman' ? 'podman' : 'docker'}
              </button>
            )}
          </div>

          {buildHint && !task && (
            <div className="rcm-note mono">
              {buildHint.text}
              {buildHint.platform && (
                <div style={{ marginTop: 8 }}>
                  <button
                    className="action-btn"
                    type="button"
                    onClick={() => {
                      const plat = buildHint.platform;
                      setBuildHint(null);
                      void runBuild('docker', plat);
                    }}
                  >
                    Rebuild on Docker as {buildHint.platform}
                  </button>
                </div>
              )}
            </div>
          )}

          {task ? (
            <div className="build-progress">
              <div className="build-log" ref={logRef}>
                {task.lines.map((l, i) => (
                  <div key={i}>{l}</div>
                ))}
              </div>
            </div>
          ) : (
            <div className="build-options">
              <div className="pull-input">
                <Glyph name="command" size={13} />
                <input
                  value={form.dockerfile}
                  onChange={(e) => setForm({ ...form, dockerfile: e.target.value })}
                  placeholder="Dockerfile path (optional, defaults to <context>/Dockerfile)"
                />
              </div>
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

      <BentoCard section="Storage" sectionIcon="disk" title="Engine disk usage" span={5} headerAlign="left">
        {df.data.length === 0 ? (
          <div className="empty" style={{ padding: '20px 8px' }}>
            <Glyph name="disk" size={20} />
            <div>{df.loading ? 'Reading system df…' : 'Engine not reachable.'}</div>
          </div>
        ) : (
          <div className="storage-rows">
            {df.data.map((r) => (
              <div key={`${r.rt}-${r.kind}`} className="storage-row">
                <span>
                  <RuntimeBadge rt={r.rt} size="xs" showLabel={false} /> {DF_LABEL[r.kind]} · {r.total}
                </span>
                <span className="mono">{formatBytes(r.sizeBytes)}</span>
                <span className="mono">{formatBytes(r.reclaimableBytes)} reclaimable</span>
              </div>
            ))}
          </div>
        )}
      </BentoCard>

      <BentoCard
        section="History"
        sectionIcon="build"
        title={`Recent Builds · ${builds.length}`}
        span={5}
        headerAlign="left"
        headerAside={
          builds.length > 0 ? (
            <button
              className="text-btn"
              type="button"
              onClick={() => BuildCommands.clearHistory().then(() => buildsRes.refetch())}
            >
              Clear
            </button>
          ) : undefined
        }
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
                  {b.rt} · {b.when} · {b.duration} · {b.cachePercent}% cache
                </div>
              </div>
              <div className="build-row-tail">
                <span className="build-size mono">{b.size}</span>
                <Pill tone={b.status === 'success' ? 'ok' : b.status === 'cancelled' ? 'dim' : 'bad'}>{b.status}</Pill>
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
        headerAside={
          selected ? (
            <button className="text-btn" type="button" onClick={() => removeBuild(selected.id)}>
              Remove record
            </button>
          ) : undefined
        }
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
                  <span>Steps</span>
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
                  <span>Image size</span>
                </div>
                <div className="build-meta-val">{selected.finalSize}</div>
              </div>
            </div>

            <div className="pull-meta mono" title={selected.dockerfilePath}>
              {selected.contextPath || selected.dockerfilePath}
            </div>

            {selected.status !== 'success' && (
              <div className="build-fail">
                <div className="bc-section">
                  <span>Build {selected.status}</span>
                </div>
                <div className="build-fail-msg mono">
                  {selected.error || `the ${selected.rt} build did not finish`}
                </div>
              </div>
            )}

            <div>
              <div className="bc-section" style={{ marginBottom: 8 }}>
                <Glyph name="bolt" size={11} />
                <span>Step timings</span>
              </div>
              <div className="layer-stack">
                {selected.layers.map((l) => (
                  <div key={l.step} className="layer-bar-row" title={l.instruction}>
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
                      {l.cached ? 'CACHED' : l.durationMs ? `${(l.durationMs / 1000).toFixed(1)}s` : '—'}
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
        title={selected?.dockerfilePath ? selected.dockerfilePath : 'Dockerfile'}
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
                  <Glyph name="bolt" size={12} /> Save to disk
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
        {saveMsg && <div className="rcm-note mono" style={{ marginBottom: 10 }}>{saveMsg}</div>}
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
