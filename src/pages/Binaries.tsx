// Binaries — runtime detection, a per-runtime setup checklist, and
// download / install / reset of the official standalone Docker / Podman CLIs.

import { useEffect, useRef, useState } from 'react';
import { BentoCard } from '@/components/ui/BentoCard';
import { StatTile } from '@/components/ui/StatTile';
import { Glyph } from '@/components/ui/Icon';
import { Pill, StatusDot } from '@/components/ui/Badge';
import { RuntimeBadge } from '@/components/ui/Runtime';
import { useHostInfo, useRuntimes } from '@/hooks/useData';
import { useResource } from '@/hooks/useResource';
import { logActivity, formatRelative } from '@/store/activityStore';
import {
  BinaryCommands,
  DOWNLOAD_PROGRESS,
  HostCommands,
  RuntimeCommands,
  type BinaryRelease,
  type DownloadEntry,
  type HostInfo,
  type SetupStatus,
} from '@/lib/commands';
import { listen, type UnlistenFn } from '@/lib/tauri';
import { RUNTIME_BRAND, RUNTIME_NAMES } from '@/data/runtimes';
import type { RuntimeMeta, RuntimeName } from '@/types';

type Phase = 'downloading' | 'extracting' | 'installing' | 'verifying' | 'done' | 'error';

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
  verifying: 'Verifying',
  done: 'Installed · verified',
  error: 'Failed',
};

// ─── Setup checklist ─────────────────────────────────────────────────────────

function SetupChecklist({
  rt,
  status,
  host,
  starting,
  onStart,
}: {
  rt: RuntimeName;
  status: SetupStatus | null;
  host: HostInfo | null;
  starting: boolean;
  onStart: () => void;
}) {
  const meta = RUNTIME_BRAND[rt];
  const os = host?.os ?? '';
  const engineAvailable = !!status?.engineApp || !!status?.engineRunning;
  const steps =
    rt === 'docker'
      ? [
          { label: 'Docker CLI installed', done: !!status?.cliInstalled },
          {
            label:
              status?.engineApp && status.engineApp !== 'running'
                ? `Engine available · ${status.engineApp}`
                : 'Container engine available',
            done: engineAvailable,
          },
          { label: 'Engine running', done: !!status?.engineRunning },
        ]
      : os === 'linux'
        ? [
            { label: 'Podman CLI installed', done: !!status?.cliInstalled },
            { label: 'Podman reachable (native, no VM)', done: !!status?.engineRunning },
          ]
        : [
            { label: 'Podman CLI installed', done: !!status?.cliInstalled },
            ...(os === 'macos'
              ? [{ label: 'VM helpers · gvproxy, vfkit', done: !!status?.helpersReady }]
              : []),
            { label: 'Podman machine created', done: !!status?.machineExists },
            { label: 'Machine running', done: !!status?.engineRunning },
          ];
  const allDone = steps.every((s) => s.done);
  const cliMissing = !status?.cliInstalled;
  const dockerNoEngine = rt === 'docker' && !engineAvailable;

  const engineHint =
    os === 'macos'
      ? 'No engine found — install OrbStack or Docker Desktop, or run brew install colima, then start it here.'
      : os === 'windows'
        ? 'No engine found — install Docker Desktop, then start it here.'
        : 'No engine found — install the docker package (dockerd) for your distribution.';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div className="bc-section">
        <Glyph name={rt === 'docker' ? 'container' : 'extension'} size={11} />
        <span>{meta.name}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {steps.map((s, i) => (
          <div key={i} className="bin-compat-row">
            <div className="bin-compat-cell">
              <StatusDot status={s.done ? 'success' : 'stopped'} />
              <span>{s.label}</span>
            </div>
            <Pill tone={s.done ? 'ok' : 'dim'}>{s.done ? 'ready' : 'pending'}</Pill>
          </div>
        ))}
      </div>
      {!status ? (
        <div className="bin-opt-sub mono">Checking…</div>
      ) : allDone ? (
        <div className="bin-opt-sub mono">{meta.name} is fully set up.</div>
      ) : cliMissing ? (
        <div className="bin-opt-sub mono">
          Download the {meta.name} CLI from the card below to begin.
        </div>
      ) : dockerNoEngine ? (
        <div className="bin-opt-sub mono">{engineHint}</div>
      ) : (
        <button
          className="action-btn primary"
          type="button"
          onClick={onStart}
          disabled={starting}
          style={{ background: meta.accent, borderColor: meta.accent }}
        >
          <Glyph name="bolt" size={12} />{' '}
          {starting ? 'starting engine…' : `Start ${meta.name} engine`}
        </button>
      )}
    </div>
  );
}

// ─── Runtime card ────────────────────────────────────────────────────────────

function BinaryRuntimeCard({
  rt,
  meta,
  releases,
  releaseError,
  selectedVersion,
  setSelectedVersion,
  task,
  onDownload,
  onRemove,
}: {
  rt: RuntimeName;
  meta: RuntimeMeta;
  releases: BinaryRelease[];
  releaseError: string | null;
  selectedVersion: string;
  setSelectedVersion: (v: string) => void;
  task: DownloadTask | null;
  onDownload: (rt: RuntimeName, version: string) => void;
  onRemove: (rt: RuntimeName) => void;
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
        {meta.found && latest && (
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
              {releaseError ? `Could not load releases: ${releaseError}` : 'Loading releases…'}
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
          <button
            className="action-btn danger"
            type="button"
            title="Remove the Dockman-installed binary (reset)"
            onClick={() => onRemove(rt)}
          >
            <Glyph name="trash" size={12} />
          </button>
        </div>
      )}
    </BentoCard>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function Binaries() {
  const { runtimes, refetch: refetchRuntimes } = useRuntimes();
  const host = useHostInfo().data;
  const downloads = useResource<DownloadEntry[]>(() => HostCommands.downloads(), [], []);

  const [releases, setReleases] = useState<Record<RuntimeName, BinaryRelease[]>>({
    docker: [],
    podman: [],
  });
  const [releaseError, setReleaseError] = useState<Record<RuntimeName, string | null>>({
    docker: null,
    podman: null,
  });
  const [selectedVersion, setSelectedVersion] = useState<Record<RuntimeName, string>>({
    docker: '',
    podman: '',
  });
  const [setup, setSetup] = useState<Record<RuntimeName, SetupStatus | null>>({
    docker: null,
    podman: null,
  });
  const [installDir, setInstallDir] = useState('');
  const [autoPath, setAutoPath] = useState(true);
  const [task, setTask] = useState<DownloadTask | null>(null);
  const [startingRt, setStartingRt] = useState<RuntimeName | null>(null);
  const [startMsg, setStartMsg] = useState<string | null>(null);
  const [resetMsg, setResetMsg] = useState<string | null>(null);
  const unlistenRef = useRef<UnlistenFn | null>(null);

  const loadSetup = () => {
    RUNTIME_NAMES.forEach((rt) => {
      RuntimeCommands.setupStatus(rt)
        .then((s) => setSetup((p) => ({ ...p, [rt]: s })))
        .catch(() => undefined);
    });
  };

  // Fetch official releases, the install directory, and the setup status.
  useEffect(() => {
    RUNTIME_NAMES.forEach((rt) => {
      BinaryCommands.releases(rt)
        .then((rs) => {
          setReleases((prev) => ({ ...prev, [rt]: rs }));
          setSelectedVersion((prev) => ({
            ...prev,
            [rt]: prev[rt] || rs[0]?.version || '',
          }));
        })
        .catch((e) => setReleaseError((prev) => ({ ...prev, [rt]: String(e) })));
    });
    BinaryCommands.defaultInstallDir().then(setInstallDir).catch(() => undefined);
    loadSetup();
  }, []);

  useEffect(
    () => () => {
      unlistenRef.current?.();
    },
    [],
  );

  const startDownload = async (rt: RuntimeName, version: string) => {
    if (task || !version) return;
    const release = releases[rt].find((r) => r.version === version);
    if (!release || !release.url) {
      setTask({
        rt,
        version,
        phase: 'error',
        percent: 0,
        message: 'no download available for this version — the release list may have failed to load',
      });
      window.setTimeout(() => setTask(null), 5000);
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
        logActivity('install', rt, `${rt} v${version}`, p.message);
        refetchRuntimes();
        loadSetup();
        downloads.refetch();
        window.setTimeout(() => setTask(null), 2800);
      }
      if (p.phase === 'error') {
        logActivity('error', rt, `${rt} v${version}`, p.message);
        downloads.refetch();
        window.setTimeout(() => setTask(null), 6000);
      }
    });
    BinaryCommands.download(rt, version, release.url, installDir).catch((e) => {
      setTask({ rt, version, phase: 'error', percent: 0, message: String(e) });
      window.setTimeout(() => setTask(null), 5000);
    });
  };

  const startEngine = async (rt: RuntimeName) => {
    if (startingRt) return;
    setStartingRt(rt);
    setStartMsg(null);
    try {
      await RuntimeCommands.startDaemon(rt);
      logActivity('start', rt, `${RUNTIME_BRAND[rt].name} engine`, 'started from Binaries');
    } catch (e) {
      setStartMsg(String(e));
    }
    refetchRuntimes();
    loadSetup();
    [4000, 12000, 24000].forEach((d) =>
      window.setTimeout(() => {
        refetchRuntimes();
        loadSetup();
      }, d),
    );
    window.setTimeout(() => setStartingRt(null), 25000);
  };

  const resetBinary = (rt: RuntimeName) => {
    setResetMsg(null);
    RuntimeCommands.removeBinary(rt)
      .then(() => {
        setResetMsg(`Removed the Dockman-installed ${rt} binary.`);
        refetchRuntimes();
        loadSetup();
      })
      .catch((e) => setResetMsg(String(e)));
  };

  const totalInstalled = RUNTIME_NAMES.filter((rt) => runtimes[rt].found).length;
  const upToDate = RUNTIME_NAMES.filter(
    (rt) => runtimes[rt].found && runtimes[rt].version === releases[rt][0]?.version,
  ).length;
  const installed = downloads.data.filter((d) => d.status === 'installed').length;

  return (
    <div className="bento">
      <div className="stat-trio" style={{ gridColumn: 'span 6' }}>
        <StatTile value={totalInstalled} label="Installed runtimes" section="Local" sectionIcon="extension" tone="violet" suffix={`/${RUNTIME_NAMES.length}`} />
        <StatTile value={upToDate} label="Up to date" section="Current" sectionIcon="bolt" tone="default" suffix={`/${Math.max(totalInstalled, 1)}`} />
        <StatTile value={installed} label="Installs by Dockman" section="History" sectionIcon="arrow" tone="default" suffix="" />
      </div>

      <BentoCard
        section="Guide"
        sectionIcon="bolt"
        title="Setup Checklist"
        span={6}
        headerAlign="left"
      >
        <div className="appearance-grid">
          <SetupChecklist
            rt="docker"
            status={setup.docker}
            host={host}
            starting={startingRt === 'docker'}
            onStart={() => startEngine('docker')}
          />
          <SetupChecklist
            rt="podman"
            status={setup.podman}
            host={host}
            starting={startingRt === 'podman'}
            onStart={() => startEngine('podman')}
          />
        </div>
        {startMsg && <div className="rcm-error mono" style={{ marginTop: 10 }}>{startMsg}</div>}
      </BentoCard>

      <BinaryRuntimeCard
        rt="docker"
        meta={runtimes.docker}
        releases={releases.docker}
        releaseError={releaseError.docker}
        selectedVersion={selectedVersion.docker}
        setSelectedVersion={(v) => setSelectedVersion((s) => ({ ...s, docker: v }))}
        task={task?.rt === 'docker' ? task : null}
        onDownload={startDownload}
        onRemove={resetBinary}
      />
      <BinaryRuntimeCard
        rt="podman"
        meta={runtimes.podman}
        releases={releases.podman}
        releaseError={releaseError.podman}
        selectedVersion={selectedVersion.podman}
        setSelectedVersion={(v) => setSelectedVersion((s) => ({ ...s, podman: v }))}
        task={task?.rt === 'podman' ? task : null}
        onDownload={startDownload}
        onRemove={resetBinary}
      />

      <BentoCard section="Install" sectionIcon="settings" title="Where binaries land" span={6} headerAlign="left">
        <div className="bin-install">
          {resetMsg && <div className="rcm-note mono">{resetMsg}</div>}
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
                {host?.os === 'windows'
                  ? 'adds the directory to your user Path after a successful install'
                  : 'appends to ~/.zshrc, ~/.bashrc, ~/.profile (and fish, if present) after a successful install'}
              </div>
            </div>
          </label>
          <label className="bin-opt-row">
            <input type="checkbox" checked readOnly />
            <div>
              <div className="bin-opt-label">Verify after download</div>
              <div className="bin-opt-sub mono">
                runs the installed binary and checks it reports the chosen version
              </div>
            </div>
          </label>
        </div>
      </BentoCard>

      <BentoCard section="Platform" sectionIcon="cpu" title="Your machine" span={6} headerAlign="left">
        <div className="bin-platform">
          <div className="bin-platform-h">
            <div className="bin-platform-os">{host?.osLabel ?? '…'}</div>
            <div className="bin-platform-arch mono">
              {host ? `${host.arch} · ${host.archLabel}` : ''}
            </div>
          </div>
          <div className="bin-platform-note">
            <Glyph name="bolt" size={12} />
            <span>
              Dockman downloads only the official standalone CLI binaries —
              <b> download.docker.com</b> for Docker and the
              <b> containers/podman</b> GitHub releases for Podman.
              {host?.os === 'macos' &&
                " Podman's VM helpers (gvproxy, vfkit) are fetched automatically on first start."}
            </span>
          </div>
          <div className="bin-compat">
            <div className="bin-compat-row">
              <div className="bin-compat-cell">
                <RuntimeBadge rt="docker" size="sm" />
                <span>
                  {host?.os === 'linux'
                    ? 'needs the dockerd service'
                    : host?.os === 'windows'
                      ? 'needs an engine — Docker Desktop or Rancher Desktop'
                      : 'needs an engine — OrbStack / Docker Desktop / Colima'}
                </span>
              </div>
              <Pill tone="ok">official</Pill>
            </div>
            <div className="bin-compat-row">
              <div className="bin-compat-cell">
                <RuntimeBadge rt="podman" size="sm" />
                <span>
                  {host?.os === 'linux'
                    ? 'self-contained — runs natively'
                    : 'self-contained — podman machine (Linux VM)'}
                </span>
              </div>
              <Pill tone="ok">official</Pill>
            </div>
          </div>
        </div>
      </BentoCard>

      <BentoCard section="History" sectionIcon="bolt" title="Installs by Dockman" span={7} headerAlign="left">
        {downloads.data.length === 0 ? (
          <div className="empty" style={{ padding: '20px 8px' }}>
            <Glyph name="arrow" size={20} />
            <div>Nothing installed through Dockman yet.</div>
          </div>
        ) : (
          <div className="bin-history">
            {downloads.data.map((h, i) => (
              <div key={i} className="bin-history-row">
                <RuntimeBadge rt={h.runtime} size="sm" />
                <div className="bin-history-body">
                  <div className="bin-history-v mono">v{h.version}</div>
                  <div className="bin-history-path mono">{h.path || h.message || '—'}</div>
                </div>
                <div className="bin-history-when mono">{formatRelative(h.at * 1000)}</div>
                <Pill tone={h.status === 'installed' ? 'ok' : 'bad'}>{h.status}</Pill>
              </div>
            ))}
          </div>
        )}
      </BentoCard>

      <BentoCard section="Source" sectionIcon="extension" title="Where we download from" span={5} headerAlign="left">
        <div className="bin-sources">
          <div className="bin-source-row">
            <RuntimeBadge rt="docker" size="sm" />
            <div className="bin-source-meta">
              <div className="bin-source-name">Docker CLI</div>
              <div className="bin-source-url mono">{host?.dockerSource ?? ''}</div>
            </div>
          </div>
          <div className="bin-source-row">
            <RuntimeBadge rt="podman" size="sm" />
            <div className="bin-source-meta">
              <div className="bin-source-name">Podman</div>
              <div className="bin-source-url mono">{host?.podmanSource ?? ''}</div>
            </div>
          </div>
          <div className="bin-source-note mono">
            Only official, standalone CLI binaries. Each install is verified by
            running the binary and checking the version it reports.
          </div>
        </div>
      </BentoCard>
    </div>
  );
}
