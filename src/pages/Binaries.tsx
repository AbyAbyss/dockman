// Binaries — Binary Manager: a guided setup checklist plus download / install
// / reset of the official standalone Docker / Podman CLIs.

import { useEffect, useRef, useState } from 'react';
import { Glyph } from '@/components/ui/Icon';
import { useRuntimes } from '@/hooks/useData';
import {
  BinaryCommands,
  RuntimeCommands,
  DOWNLOAD_PROGRESS,
  type BinaryRelease,
  type SetupStatus,
} from '@/lib/commands';
import { isTauri, listen, type UnlistenFn } from '@/lib/tauri';
import { BINARY_MANIFEST, DOWNLOAD_HISTORY, RUNTIMES } from '@/data/seed';
import type { RuntimeName } from '@/types';

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

/** Browser-mode fallback setup status. */
function seedSetup(rt: RuntimeName): SetupStatus {
  return {
    runtime: rt,
    cliInstalled: true,
    cliVersion: RUNTIMES[rt].version,
    engineRunning: RUNTIMES[rt].running,
    helpersReady: true,
    machineExists: true,
    engineApp: rt === 'docker' ? 'OrbStack' : '',
  };
}

/** The checks `SetupStatus` reports, per runtime. */
function stepsFor(rt: RuntimeName, status: SetupStatus | null) {
  const engineAvailable = !!status?.engineApp || !!status?.engineRunning;
  return rt === 'docker'
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
    : [
        { label: 'Podman CLI installed', done: !!status?.cliInstalled },
        { label: 'VM helpers · gvproxy, vfkit', done: !!status?.helpersReady },
        { label: 'Podman machine created', done: !!status?.machineExists },
        { label: 'Machine running', done: !!status?.engineRunning },
      ];
}

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
  const [setup, setSetup] = useState<Record<RuntimeName, SetupStatus | null>>({
    docker: live ? null : seedSetup('docker'),
    podman: live ? null : seedSetup('podman'),
  });
  const [installDir, setInstallDir] = useState('~/.local/bin');
  const [autoPath, setAutoPath] = useState(true);
  const [verifyAfter, setVerifyAfter] = useState(true);
  const [task, setTask] = useState<DownloadTask | null>(null);
  const [startingRt, setStartingRt] = useState<RuntimeName | null>(null);
  const unlistenRef = useRef<UnlistenFn | null>(null);

  const loadSetup = () => {
    if (!live) return;
    RUNTIME_KEYS.forEach((rt) => {
      RuntimeCommands.setupStatus(rt)
        .then((s) => setSetup((p) => ({ ...p, [rt]: s })))
        .catch(() => undefined);
    });
  };

  // Fetch official releases, the install directory, and the setup status.
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
    loadSetup();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        if (verifyAfter && p.message)
          BinaryCommands.verify(p.message).catch(() => undefined);
        refetchRuntimes();
        loadSetup();
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

  const startEngine = async (rt: RuntimeName) => {
    if (startingRt) return;
    setStartingRt(rt);
    try {
      await RuntimeCommands.startDaemon(rt);
    } catch {
      /* the checklist re-fetch reflects the real state */
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
    RuntimeCommands.removeBinary(rt)
      .then(() => {
        refetchRuntimes();
        loadSetup();
      })
      .catch(() => undefined);
  };

  const allReady = RUNTIME_KEYS.every((rt) =>
    stepsFor(rt, setup[rt]).every((s) => s.done),
  );

  return (
    <div className="screen-pad bin">
      {/* ─── Setup checklist ───────────────────────────────────────────── */}
      <div className="card">
        <div className="ov-card-head">
          <span className="card-title">Setup checklist</span>
          <span className="toolbar-note mono">
            {allReady ? 'both runtimes ready' : 'setup incomplete'}
          </span>
        </div>
        <div className="bin-check-cols">
          {RUNTIME_KEYS.map((rt) => {
            const steps = stepsFor(rt, setup[rt]);
            const engineDown = !!setup[rt]?.cliInstalled && !setup[rt]?.engineRunning;
            return (
              <div key={rt} className="bin-check-col">
                <div className="bin-check-head">
                  <span
                    className="ov-engine-dot"
                    style={{ background: runtimes[rt].accent }}
                  />
                  <span className="bin-check-name">{runtimes[rt].name}</span>
                  {engineDown && (
                    <button
                      type="button"
                      className="text-btn"
                      disabled={startingRt === rt}
                      onClick={() => startEngine(rt)}
                    >
                      {startingRt === rt ? 'starting…' : 'start engine'}
                    </button>
                  )}
                </div>
                {steps.map((s) => (
                  <div key={s.label} className="bin-check-row">
                    <span className={`bin-check-mark ${s.done ? 'is-on' : ''}`}>
                      {s.done && <Glyph name="check" size={9} sw={3} />}
                    </span>
                    <span className="bin-check-label">{s.label}</span>
                    <span className={`bin-check-state mono ${s.done ? 'is-on' : ''}`}>
                      {s.done ? 'READY' : 'MISSING'}
                    </span>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
        <div className="bin-note mono">
          Dockman only downloads official standalone CLI binaries — it never installs
          Docker Desktop or changes an engine you already manage.
        </div>
      </div>

      {/* ─── Runtime cards ─────────────────────────────────────────────── */}
      <div className="bin-runtimes">
        {RUNTIME_KEYS.map((rt) => {
          const meta = runtimes[rt];
          const list = releases[rt];
          const latest = list[0]?.version ?? meta.latest;
          const current = meta.version;
          const upToDate = meta.found && current === latest;
          const active = task?.rt === rt ? task : null;
          const chosen = selectedVersion[rt] || latest;

          return (
            <div key={rt} className="card bin-card">
              <div className="bin-card-head">
                <span className={`bin-icon rt-${rt}`}>
                  <Glyph name="extension" size={18} />
                </span>
                <div className="bin-id">
                  <div className="bin-name">{meta.name}</div>
                  <div className="bin-meta mono">
                    <span
                      className="ov-engine-dot"
                      style={{ background: meta.running ? meta.accent : undefined }}
                    />
                    v{current} · latest {latest}
                  </div>
                </div>
                <span className={`bin-state mono ${upToDate ? 'is-on' : 'is-warn'}`}>
                  {upToDate ? 'UP TO DATE' : 'UPDATE AVAILABLE'}
                </span>
              </div>

              <div className="bin-path">
                <span className="mono">{meta.path}</span>
                <button
                  type="button"
                  className="text-btn"
                  onClick={() =>
                    BinaryCommands.defaultInstallDir()
                      .then((d) => RuntimeCommands.setPath(rt, d))
                      .then(() => refetchRuntimes())
                      .catch(() => undefined)
                  }
                >
                  Browse
                </button>
              </div>

              <div className="section-label">
                OFFICIAL RELEASES · {BINARY_MANIFEST[rt].platform}
              </div>
              <div className="bin-versions">
                {list.length === 0 && (
                  <div className="det-empty mono">fetching releases…</div>
                )}
                {list.slice(0, 4).map((r, i) => {
                  const seedInfo = BINARY_MANIFEST[rt].versions.find(
                    (v) => v.v === r.version,
                  );
                  return (
                    <button
                      key={r.version}
                      type="button"
                      className={`bin-version ${i === 0 ? 'is-latest' : ''} ${chosen === r.version ? 'is-chosen' : ''}`}
                      onClick={() =>
                        setSelectedVersion((p) => ({ ...p, [rt]: r.version }))
                      }
                    >
                      <span className="mono">{r.version}</span>
                      {i === 0 && <span className="latest-chip mono">LATEST</span>}
                      <span className="bin-version-meta mono">
                        {seedInfo ? `${seedInfo.released} · ${seedInfo.size}` : r.platform}
                      </span>
                    </button>
                  );
                })}
              </div>

              {active ? (
                <div className="bin-task">
                  <div className="bin-task-row mono">
                    <span>
                      {PHASE_LABEL[active.phase]} {active.version}
                    </span>
                    <span>{active.percent}%</span>
                  </div>
                  <div className="track">
                    <div
                      className={`track-fill ${active.phase === 'error' ? 'tone-bad' : ''}`}
                      style={{ width: `${active.percent}%` }}
                    />
                  </div>
                  {active.message && (
                    <div className="bin-task-msg mono">{active.message}</div>
                  )}
                </div>
              ) : (
                <div className="bin-foot">
                  <button
                    type="button"
                    className="bin-install"
                    style={{ background: meta.accent }}
                    onClick={() => startDownload(rt, chosen)}
                  >
                    Install v{chosen}
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    title={`Remove the ${meta.name} binary Dockman installed`}
                    onClick={() => resetBinary(rt)}
                  >
                    <Glyph name="more" size={13} sw={2.2} />
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ─── Bottom row ────────────────────────────────────────────────── */}
      <div className="ov-row-3">
        <div className="card bin-loc">
          <div className="card-title">Install location</div>
          <input
            className="field mono"
            value={installDir}
            onChange={(e) => setInstallDir(e.target.value)}
          />
          <button
            type="button"
            className="check-row"
            onClick={() => setAutoPath(!autoPath)}
            aria-pressed={autoPath}
          >
            <span className={`check-box ${autoPath ? 'is-on' : ''}`}>
              {autoPath && <Glyph name="check" size={10} sw={3} />}
            </span>
            Automatically add to PATH
          </button>
          <div className="bin-sub mono">
            appends the directory to your shell profile so `docker` resolves in new
            terminals
          </div>
          <button
            type="button"
            className="check-row"
            onClick={() => setVerifyAfter(!verifyAfter)}
            aria-pressed={verifyAfter}
          >
            <span className={`check-box ${verifyAfter ? 'is-on' : ''}`}>
              {verifyAfter && <Glyph name="check" size={10} sw={3} />}
            </span>
            Verify after download
          </button>
          <div className="bin-sub mono">
            runs the binary once and records the version it reports
          </div>
        </div>

        <div className="card bin-dl">
          <div className="card-title">Recent downloads</div>
          {DOWNLOAD_HISTORY.map((d, i) => (
            <div key={i} className="bin-dl-row">
              <span
                className="ov-engine-dot"
                style={{ background: RUNTIMES[d.rt].accent }}
              />
              <div className="bin-dl-id">
                <div className="bin-dl-v">
                  {d.rt} {d.v}
                </div>
                <div className="bin-dl-p mono">{d.path}</div>
              </div>
              <div className="bin-dl-state">
                <div className="mono">{d.when}</div>
                <div className={`bin-dl-status mono ${d.status === 'success' ? 'is-on' : ''}`}>
                  {d.status.toUpperCase()}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="card bin-machine">
          <div className="card-title">Your machine</div>
          <div className="bin-os">macOS</div>
          <div className="bin-sub mono">
            {runtimes.docker.arch} · Apple Silicon · 12 cores · 16 GB
          </div>
          <div className="callout">
            <div className="callout-body mono">
              Only official standalone CLI binaries are downloaded, verified against the
              vendor checksum, and installed into your own directory.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
