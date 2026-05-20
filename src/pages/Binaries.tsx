// Binaries — Binary Manager: download & install the official standalone
// Docker / Podman CLIs. No Docker Desktop, no VM.

import { useEffect, useRef, useState } from 'react';
import { BentoCard } from '@/components/ui/BentoCard';
import { StatTile } from '@/components/ui/StatTile';
import { Glyph } from '@/components/ui/Icon';
import { Pill } from '@/components/ui/Badge';
import { RuntimeBadge } from '@/components/ui/Runtime';
import { useRuntimes } from '@/hooks/useData';
import {
  BinaryCommands,
  RuntimeCommands,
  DOWNLOAD_PROGRESS,
  type BinaryRelease,
} from '@/lib/commands';
import { isTauri, listen, type UnlistenFn } from '@/lib/tauri';
import { BINARY_MANIFEST, DOWNLOAD_HISTORY } from '@/data/seed';
import type { RuntimeMeta, RuntimeName } from '@/types';

type Phase = 'downloading' | 'extracting' | 'installing' | 'done' | 'error';

interface DownloadTask {
  rt: RuntimeName;
  version: string;
  phase: Phase;
  percent: number;
  message: string;
}

const PHASE_LABEL: Record<Phase, string> = {
  downloading: 'Downloading',
  extracting: 'Extracting',
  installing: 'Installing',
  done: 'Installed',
  error: 'Failed',
};

const RUNTIME_KEYS: RuntimeName[] = ['docker', 'podman'];

/** Browser-mode fallback release list (from the seed manifest). */
function seedReleases(rt: RuntimeName): BinaryRelease[] {
  return BINARY_MANIFEST[rt].versions.map((v) => ({
    version: v.v,
    url: '',
    platform: BINARY_MANIFEST[rt].platform,
    arch: 'arm64',
  }));
}

// ─── Runtime card ────────────────────────────────────────────────────────────

function BinaryRuntimeCard({
  rt,
  meta,
  releases,
  selectedVersion,
  setSelectedVersion,
  task,
  onDownload,
}: {
  rt: RuntimeName;
  meta: RuntimeMeta;
  releases: BinaryRelease[];
  selectedVersion: string;
  setSelectedVersion: (v: string) => void;
  task: DownloadTask | null;
  onDownload: (rt: RuntimeName, version: string) => void;
}) {
  const latest = releases[0]?.version ?? '';
  const isLatest = meta.found && !!latest && meta.version === latest;

  return (
    <BentoCard span={6} className={`bc-binary bc-binary-${rt}`}>
      <div className="bin-card-h">
        <div className={`bin-card-mark rt-${rt}`}>
          <Glyph name={rt === 'docker' ? 'container' : 'extension'} size={26} />
        </div>
        <div className="bin-card-id">
          <div className="bin-card-name">{meta.name}</div>
          {meta.found ? (
            <div className="bin-card-status">
              <span
                className="ok-dot"
                style={{ background: meta.accent, boxShadow: `0 0 0 4px ${meta.soft}` }}
              />
              v{meta.version}
              {isLatest ? ' · up to date' : latest ? ` · latest ${latest}` : ''}
            </div>
          ) : (
            <div className="bin-card-status not-found">
              <span className="dot" style={{ background: 'var(--bad)' }} />
              Not installed
            </div>
          )}
        </div>
        {meta.found && (
          <Pill tone={isLatest ? 'ok' : 'warn'}>
            {isLatest ? 'latest' : 'update available'}
          </Pill>
        )}
      </div>

      {meta.found && <div className="bin-card-path mono">{meta.path}</div>}

      <div className="bin-card-versions">
        <div className="bc-section">
          <span>Official releases · {meta.arch || 'host'}</span>
        </div>
        <div className="version-list">
          {releases.length === 0 && (
            <div className="version-meta mono" style={{ padding: '8px 2px' }}>
              Loading releases…
            </div>
          )}
          {releases.map((r, i) => (
            <button
              key={r.version}
              type="button"
              className={`version-row ${selectedVersion === r.version ? 'is-on' : ''} ${
                meta.found && meta.version === r.version ? 'is-installed' : ''
              }`}
              onClick={() => setSelectedVersion(r.version)}
            >
              <div className="version-tag-col">
                <span className="version-v mono">v{r.version}</span>
                {i === 0 && <Pill tone="ok">latest</Pill>}
                {meta.found && meta.version === r.version && (
                  <Pill tone="dim">installed</Pill>
                )}
              </div>
              <div className="version-meta mono">{r.arch}</div>
            </button>
          ))}
        </div>
      </div>

      {task ? (
        <div className="bin-progress">
          <div className="bin-progress-h">
            <span className="bin-progress-label">{PHASE_LABEL[task.phase]}</span>
            <span className="mono">
              {task.phase === 'done'
                ? '✓'
                : task.phase === 'error'
                  ? '✕'
                  : `${task.percent}%`}
            </span>
          </div>
          <div className="pull-bar">
            <div
              className="pull-fill"
              style={{
                width: `${task.percent}%`,
                background: task.phase === 'error' ? 'var(--bad)' : meta.accent,
              }}
            />
          </div>
          <div className="bin-progress-meta mono">
            {task.phase === 'error'
              ? task.message || 'download failed'
              : `${rt} v${task.version}${
                  task.phase === 'done' && task.message ? ` → ${task.message}` : ''
                }`}
          </div>
        </div>
      ) : (
        <div className="bin-card-actions">
          {!meta.found || meta.version !== selectedVersion ? (
            <button
              className="action-btn primary bin-cta"
              type="button"
              style={{ background: meta.accent, borderColor: meta.accent }}
              disabled={!selectedVersion}
              onClick={() => onDownload(rt, selectedVersion)}
            >
              <Glyph name="arrow" size={12} />{' '}
              {meta.found ? 'Install' : 'Download'} v{selectedVersion || '—'}
            </button>
          ) : (
            <button className="action-btn" type="button" disabled>
              <Glyph name="bolt" size={12} /> v{meta.version} active
            </button>
          )}
        </div>
      )}
    </BentoCard>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function Binaries() {
  const { runtimes, refetch: refetchRuntimes } = useRuntimes();
  const live = isTauri();

  const [releases, setReleases] = useState<Record<RuntimeName, BinaryRelease[]>>({
    docker: live ? [] : seedReleases('docker'),
    podman: live ? [] : seedReleases('podman'),
  });
  const [selectedVersion, setSelectedVersion] = useState<Record<RuntimeName, string>>({
    docker: '',
    podman: '',
  });
  const [installDir, setInstallDir] = useState('~/.local/bin');
  const [autoPath, setAutoPath] = useState(true);
  const [task, setTask] = useState<DownloadTask | null>(null);
  const unlistenRef = useRef<UnlistenFn | null>(null);

  // Fetch official releases + the default install directory.
  useEffect(() => {
    if (!live) {
      setSelectedVersion({
        docker: seedReleases('docker')[0]?.version ?? '',
        podman: seedReleases('podman')[0]?.version ?? '',
      });
      return;
    }
    RUNTIME_KEYS.forEach((rt) => {
      BinaryCommands.releases(rt)
        .then((rs) => {
          setReleases((prev) => ({ ...prev, [rt]: rs }));
          setSelectedVersion((prev) => ({
            ...prev,
            [rt]: prev[rt] || rs[0]?.version || '',
          }));
        })
        .catch(() => undefined);
    });
    BinaryCommands.defaultInstallDir().then(setInstallDir).catch(() => undefined);
  }, [live]);

  useEffect(
    () => () => {
      unlistenRef.current?.();
    },
    [],
  );

  const simulate = (rt: RuntimeName, version: string) => {
    const phases: { phase: Phase; percent: number }[] = [
      { phase: 'downloading', percent: 15 },
      { phase: 'extracting', percent: 55 },
      { phase: 'installing', percent: 85 },
      { phase: 'done', percent: 100 },
    ];
    let i = 0;
    setTask({ rt, version, ...phases[0], message: '' });
    const id = window.setInterval(() => {
      i += 1;
      setTask({ rt, version, ...phases[i], message: '' });
      if (i >= phases.length - 1) {
        window.clearInterval(id);
        window.setTimeout(() => setTask(null), 2200);
      }
    }, 700);
  };

  const startDownload = async (rt: RuntimeName, version: string) => {
    if (task || !version) return;
    const release = releases[rt].find((r) => r.version === version);

    if (!live || !release || !release.url) {
      simulate(rt, version);
      return;
    }

    setTask({ rt, version, phase: 'downloading', percent: 8, message: '' });
    unlistenRef.current?.();
    unlistenRef.current = await listen<{
      runtime: string;
      phase: string;
      percent: number;
      message: string;
    }>(DOWNLOAD_PROGRESS, (p) => {
      if (p.runtime !== rt) return;
      setTask({
        rt,
        version,
        phase: p.phase as Phase,
        percent: p.percent,
        message: p.message,
      });
      if (p.phase === 'done') {
        if (p.message) RuntimeCommands.setPath(rt, p.message).catch(() => undefined);
        if (autoPath) BinaryCommands.addToPath(installDir).catch(() => undefined);
        refetchRuntimes();
        window.setTimeout(() => setTask(null), 2800);
      }
      if (p.phase === 'error') {
        window.setTimeout(() => setTask(null), 5000);
      }
    });
    BinaryCommands.download(rt, version, release.url, installDir).catch((e) => {
      setTask({ rt, version, phase: 'error', percent: 0, message: String(e) });
      window.setTimeout(() => setTask(null), 5000);
    });
  };

  const totalInstalled = RUNTIME_KEYS.filter((rt) => runtimes[rt].found).length;
  const upToDate = RUNTIME_KEYS.filter(
    (rt) => runtimes[rt].found && runtimes[rt].version === releases[rt][0]?.version,
  ).length;

  return (
    <div className="bento">
      <div className="stat-trio" style={{ gridColumn: 'span 6' }}>
        <StatTile value={totalInstalled} label="Installed runtimes" section="Local" sectionIcon="extension" tone="violet" suffix={`/${RUNTIME_KEYS.length}`} />
        <StatTile value={upToDate} label="Up to date" section="Current" sectionIcon="bolt" tone="default" suffix={`/${Math.max(totalInstalled, 1)}`} />
        <StatTile value={DOWNLOAD_HISTORY.length} label="Downloads" section="History" sectionIcon="arrow" tone="default" suffix="" />
      </div>

      <BinaryRuntimeCard
        rt="docker"
        meta={runtimes.docker}
        releases={releases.docker}
        selectedVersion={selectedVersion.docker}
        setSelectedVersion={(v) => setSelectedVersion((s) => ({ ...s, docker: v }))}
        task={task?.rt === 'docker' ? task : null}
        onDownload={startDownload}
      />
      <BinaryRuntimeCard
        rt="podman"
        meta={runtimes.podman}
        releases={releases.podman}
        selectedVersion={selectedVersion.podman}
        setSelectedVersion={(v) => setSelectedVersion((s) => ({ ...s, podman: v }))}
        task={task?.rt === 'podman' ? task : null}
        onDownload={startDownload}
      />

      <BentoCard section="Install" sectionIcon="settings" title="Where binaries land" span={6} headerAlign="left">
        <div className="bin-install">
          <div className="bin-path-row">
            <div className="bc-section">
              <span>Install directory</span>
            </div>
            <div className="pull-input">
              <Glyph name="volume" size={13} />
              <input
                value={installDir}
                onChange={(e) => setInstallDir(e.target.value)}
                className="mono"
              />
            </div>
          </div>
          <label className="bin-opt-row">
            <input
              type="checkbox"
              checked={autoPath}
              onChange={(e) => setAutoPath(e.target.checked)}
            />
            <div>
              <div className="bin-opt-label">Automatically add to PATH</div>
              <div className="bin-opt-sub mono">
                appends to ~/.zshrc and ~/.bashrc after a successful install
              </div>
            </div>
          </label>
          <label className="bin-opt-row">
            <input type="checkbox" checked readOnly />
            <div>
              <div className="bin-opt-label">Verify after download</div>
              <div className="bin-opt-sub mono">
                re-detects the runtime to confirm the install worked
              </div>
            </div>
          </label>
        </div>
      </BentoCard>

      <BentoCard section="Platform" sectionIcon="cpu" title="Your machine" span={6} headerAlign="left">
        <div className="bin-platform">
          <div className="bin-platform-h">
            <div className="bin-platform-os">macOS</div>
            <div className="bin-platform-arch mono">
              {runtimes.docker.arch || 'aarch64'} · Apple Silicon
            </div>
          </div>
          <div className="bin-platform-note">
            <Glyph name="bolt" size={12} />
            <span>
              Dockman downloads only the official standalone CLI binaries —
              <b> download.docker.com</b> for Docker and the
              <b> containers/podman</b> GitHub releases for Podman. No Docker
              Desktop or Podman Desktop installers.
            </span>
          </div>
          <div className="bin-compat">
            <div className="bin-compat-row">
              <div className="bin-compat-cell">
                <RuntimeBadge rt="docker" size="sm" />
                <span>download.docker.com/&hellip;/static/stable</span>
              </div>
              <Pill tone="ok">official</Pill>
            </div>
            <div className="bin-compat-row">
              <div className="bin-compat-cell">
                <RuntimeBadge rt="podman" size="sm" />
                <span>github.com/containers/podman/releases</span>
              </div>
              <Pill tone="ok">official</Pill>
            </div>
          </div>
        </div>
      </BentoCard>

      <BentoCard section="History" sectionIcon="bolt" title="Recent Downloads" span={7} headerAlign="left">
        <div className="bin-history">
          {DOWNLOAD_HISTORY.map((h, i) => (
            <div key={i} className="bin-history-row">
              <RuntimeBadge rt={h.rt} size="sm" />
              <div className="bin-history-body">
                <div className="bin-history-v mono">v{h.v}</div>
                <div className="bin-history-path mono">{h.path}</div>
              </div>
              <div className="bin-history-when mono">{h.when}</div>
              <Pill tone={h.status === 'success' ? 'ok' : 'dim'}>{h.status}</Pill>
            </div>
          ))}
        </div>
      </BentoCard>

      <BentoCard section="Source" sectionIcon="extension" title="Where we download from" span={5} headerAlign="left">
        <div className="bin-sources">
          <div className="bin-source-row">
            <RuntimeBadge rt="docker" size="sm" />
            <div className="bin-source-meta">
              <div className="bin-source-name">Docker CLI</div>
              <div className="bin-source-url mono">{BINARY_MANIFEST.docker.source}</div>
            </div>
          </div>
          <div className="bin-source-row">
            <RuntimeBadge rt="podman" size="sm" />
            <div className="bin-source-meta">
              <div className="bin-source-name">Podman</div>
              <div className="bin-source-url mono">{BINARY_MANIFEST.podman.source}</div>
            </div>
          </div>
          <div className="bin-source-note mono">
            Only official, standalone CLI binaries — verified by re-detecting the
            runtime after install.
          </div>
        </div>
      </BentoCard>
    </div>
  );
}
