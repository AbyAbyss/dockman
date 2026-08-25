// Settings — runtime selection, engine resources, capabilities, registries,
// appearance, updates and maintenance.

import { useState } from 'react';
import { Glyph } from '@/components/ui/Icon';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useAppStore } from '@/store/appStore';
import { ACCENTS, MODES, PALETTES, useThemeStore } from '@/store/themeStore';
import { useWizardStore } from '@/store/wizardStore';
import { useRuntimes } from '@/hooks/useData';
import { SystemCommands } from '@/lib/commands';
import type {
  AccentName,
  PaletteName,
  RuntimeFilter,
  RuntimeName,
  ThemeMode,
} from '@/types';

/** Registries are presentational — no backend command lists them yet. */
const REGISTRIES = [
  { name: 'docker.io', account: 'library · anonymous pulls', connected: true },
  { name: 'ghcr.io', account: 'AbyAbyss', connected: true },
  { name: 'gcr.io', account: 'not signed in', connected: false },
];

const RECENT_CHANGES = [
  { v: '0.1.0', s: 'stack-grouped containers, bulk actions, resizable detail pane' },
  { v: '0.0.9', s: 'compose scaling, exec sessions, build history' },
  { v: '0.0.8', s: 'podman machine helpers, binary manager' },
];

/** 30 × 17px pill switch. */
function Toggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      className={`switch ${on ? 'is-on' : ''}`}
      onClick={onToggle}
      aria-pressed={on}
    >
      <span className="switch-knob" />
    </button>
  );
}

function Slider({
  label,
  value,
  unit,
  min,
  max,
  hint,
  onChange,
}: {
  label: string;
  value: number;
  unit: string;
  min: number;
  max: number;
  hint: string;
  onChange: (v: number) => void;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="slider-block">
      <div className="slider-head">
        <span className="slider-label">{label}</span>
        <span className="slider-val">{value}</span>
        <span className="slider-unit mono">{unit}</span>
      </div>
      <div className="slider-wrap">
        <div className="track">
          <div className="track-fill" style={{ width: `${pct}%` }} />
        </div>
        <span className="slider-thumb" style={{ left: `${pct}%` }} />
        <input
          className="slider-input"
          type="range"
          min={min}
          max={max}
          value={value}
          aria-label={label}
          onChange={(e) => onChange(Number(e.target.value))}
        />
      </div>
      <div className="slider-hint mono">{hint}</div>
    </div>
  );
}

export default function Settings() {
  const theme = useThemeStore();
  const runtimeFilter = useAppStore((s) => s.runtimeFilter);
  const setRuntimeFilter = useAppStore((s) => s.setRuntimeFilter);
  const { runtimes } = useRuntimes();
  const replayWizard = useWizardStore((s) => s.setCompleted);

  const [cpu, setCpu] = useState(8);
  const [ram, setRam] = useState(8);
  const [swap, setSwap] = useState(1);
  const [disk, setDisk] = useState(60);
  const [channel, setChannel] = useState('Stable');
  const [confirm, setConfirm] = useState<'prune' | 'reset' | null>(null);
  const [features, setFeatures] = useState({
    composeV2: true,
    buildKit: true,
    rosetta: true,
    swarm: false,
    kubernetes: false,
    experimentalCli: false,
    autoStart: true,
    sendUsage: false,
  });
  const toggleFeat = (k: keyof typeof features) =>
    setFeatures((f) => ({ ...f, [k]: !f[k] }));

  const capabilities: { k: keyof typeof features; l: string; s: string }[] = [
    { k: 'composeV2', l: 'Compose v2', s: 'docker compose subcommand' },
    { k: 'buildKit', l: 'BuildKit', s: 'parallel, cache-aware builds' },
    { k: 'rosetta', l: 'Rosetta', s: 'run amd64 images on Apple Silicon' },
    { k: 'swarm', l: 'Swarm mode', s: 'cluster orchestration' },
    { k: 'kubernetes', l: 'Kubernetes', s: 'single-node cluster' },
    { k: 'experimentalCli', l: 'Experimental CLI', s: 'unreleased subcommands' },
    { k: 'autoStart', l: 'Auto-start engine', s: 'start the engine at login' },
    { k: 'sendUsage', l: 'Usage stats', s: 'anonymous feature counters' },
  ];

  const runtimeRows: { k: RuntimeFilter; name: string; sub: string; rt?: RuntimeName }[] =
    [
      {
        k: 'docker',
        name: 'Docker',
        sub: `v${runtimes.docker.version} · ${runtimes.docker.path}`,
        rt: 'docker',
      },
      {
        k: 'podman',
        name: 'Podman',
        sub: `v${runtimes.podman.version} · ${runtimes.podman.path}`,
        rt: 'podman',
      },
      { k: 'all', name: 'Both', sub: 'unified view across both engines' },
    ];

  return (
    <div className="screen-pad set">
      <div className="set-grid">
        {/* 1 — Active runtime */}
        <div className="card set-card">
          <div className="card-title">Active runtime</div>
          {runtimeRows.map((r) => (
            <button
              key={r.k}
              type="button"
              className={`set-rt-row ${runtimeFilter === r.k ? 'is-on' : ''}`}
              onClick={() => setRuntimeFilter(r.k)}
            >
              <span className={`set-rt-icon ${r.rt ? `rt-${r.rt}` : 'rt-both'}`}>
                <Glyph name={r.rt ? 'container' : 'layers'} size={14} />
              </span>
              <span className="set-rt-id">
                <span className="set-rt-name">{r.name}</span>
                <span className="set-rt-sub mono">{r.sub}</span>
              </span>
              <span className="set-rt-check">
                {runtimeFilter === r.k && <Glyph name="check" size={15} sw={2.2} />}
              </span>
            </button>
          ))}
          <button
            type="button"
            className="check-row"
            onClick={() => theme.setM1Fallback(!theme.m1Fallback)}
            aria-pressed={theme.m1Fallback}
          >
            <span className={`check-box ${theme.m1Fallback ? 'is-on' : ''}`}>
              {theme.m1Fallback && <Glyph name="check" size={10} sw={3} />}
            </span>
            M1 auto-fallback
          </button>
          <div className="bin-sub mono">
            when an image has no arm64 variant, re-run it under emulation instead of
            failing
          </div>
        </div>

        {/* 2 — Engine resources */}
        <div className="card set-card">
          <div className="card-title">Engine resources</div>
          <Slider label="CPUs" value={cpu} unit="cores" min={1} max={12} hint="of 12 available" onChange={setCpu} />
          <Slider label="Memory" value={ram} unit="GB" min={1} max={16} hint="of 16 GB installed" onChange={setRam} />
          <Slider label="Swap" value={swap} unit="GB" min={0} max={4} hint="disk-backed overflow" onChange={setSwap} />
          <Slider label="Disk image" value={disk} unit="GB" min={16} max={256} hint="maximum size of the engine's virtual disk" onChange={setDisk} />
        </div>

        {/* 3 — Capabilities */}
        <div className="card set-card set-wide">
          <div className="card-title">Capabilities</div>
          <div className="cap-grid">
            {capabilities.map((c) => (
              <div key={c.k} className="cap-row">
                <div className="cap-id">
                  <div className="cap-l">{c.l}</div>
                  <div className="cap-s mono">{c.s}</div>
                </div>
                <Toggle on={features[c.k]} onToggle={() => toggleFeat(c.k)} />
              </div>
            ))}
          </div>
        </div>

        {/* 4 — Registries */}
        <div className="card set-card">
          <div className="card-title">Registries</div>
          {REGISTRIES.map((r) => (
            <div key={r.name} className="reg-row">
              <div className="reg-id">
                <div className="reg-name mono">{r.name}</div>
                <div className="reg-account mono">{r.account}</div>
              </div>
              <span className={`state-chip mono ${r.connected ? 'is-on' : ''}`}>
                {r.connected ? 'CONNECTED' : 'DISCONNECTED'}
              </span>
              <button type="button" className="text-btn">
                {r.connected ? 'sign out' : 'sign in'}
              </button>
            </div>
          ))}
        </div>

        {/* 5 — Appearance */}
        <div className="card set-card">
          <div className="card-title">Appearance</div>

          <div className="section-label">THEME</div>
          <div className="mode-row">
            {(Object.keys(MODES) as ThemeMode[]).map((m) => (
              <button
                key={m}
                type="button"
                className={`mode-card ${theme.mode === m ? 'is-on' : ''}`}
                onClick={() => theme.setMode(m)}
                aria-pressed={theme.mode === m}
              >
                <span className={`mode-swatch mode-${m}`}>
                  <span className="mode-swatch-bar" />
                  <span className="mode-swatch-bar" />
                  <span className="mode-swatch-dot" />
                </span>
                <span className="mode-id">
                  <span className="mode-name">{MODES[m].label}</span>
                  <span className="mode-blurb mono">{MODES[m].blurb}</span>
                </span>
              </button>
            ))}
          </div>

          <div className="section-label">PALETTE</div>
          <div className="pill-row">
            {(Object.keys(PALETTES) as PaletteName[]).map((p) => (
              <button
                key={p}
                type="button"
                className={`ctr-pill ${theme.palette === p ? 'is-on' : ''}`}
                onClick={() => theme.setPalette(p)}
              >
                {p}
              </button>
            ))}
          </div>

          <div className="section-label">ACCENT</div>
          <div className="swatch-row">
            {(Object.keys(ACCENTS) as AccentName[]).map((a) => (
              <button
                key={a}
                type="button"
                className={`swatch ${theme.accent === a ? 'is-on' : ''}`}
                title={a}
                aria-label={a}
                style={{
                  background: ACCENTS[a].hex,
                  boxShadow: theme.accent === a ? `0 0 0 2px ${ACCENTS[a].hex}` : undefined,
                }}
                onClick={() => theme.setAccent(a)}
              />
            ))}
          </div>

          <div className="section-label">SIDEBAR</div>
          <div className="pill-row">
            <button
              type="button"
              className={`ctr-pill ${!theme.tabCollapsed ? 'is-on' : ''}`}
              onClick={() => theme.setTabCollapsed(false)}
            >
              Icons + labels
            </button>
            <button
              type="button"
              className={`ctr-pill ${theme.tabCollapsed ? 'is-on' : ''}`}
              onClick={() => theme.setTabCollapsed(true)}
            >
              Icons only
            </button>
          </div>

          <div className="section-label">WINDOW</div>
          <div className="pill-row">
            <button
              type="button"
              className={`ctr-pill ${!theme.translucent ? 'is-on' : ''}`}
              onClick={() => theme.setTranslucent(false)}
            >
              Opaque
            </button>
            <button
              type="button"
              className={`ctr-pill ${theme.translucent ? 'is-on' : ''}`}
              onClick={() => theme.setTranslucent(true)}
            >
              Translucent
            </button>
          </div>
        </div>

        {/* 6 — Updates */}
        <div className="card set-card">
          <div className="card-title">Updates</div>
          <div className="set-version">
            <span className="set-version-n">0.1.0</span>
            <span className="latest-chip mono">LATEST</span>
          </div>
          <div className="bin-sub mono">up to date · checked 12m ago</div>

          <div className="section-label">CHANNEL</div>
          <div className="pill-row">
            {['Stable', 'Beta', 'Edge'].map((c) => (
              <button
                key={c}
                type="button"
                className={`ctr-pill ${channel === c ? 'is-on' : ''}`}
                onClick={() => setChannel(c)}
              >
                {c}
              </button>
            ))}
          </div>

          <div className="section-label">RECENT CHANGES</div>
          {RECENT_CHANGES.map((c) => (
            <div key={c.v} className="change-row">
              <span className="change-v mono">{c.v}</span>
              <span className="change-s">{c.s}</span>
            </div>
          ))}
        </div>

        {/* 7 — Maintenance */}
        <div className="card set-card set-wide set-danger">
          <div className="card-title">Maintenance</div>
          <div className="maint-row">
            <div className="maint-id">
              <div className="maint-l">Setup wizard</div>
              <div className="maint-s mono">replay the first-run guided setup</div>
            </div>
            <button type="button" className="pill-btn" onClick={() => replayWizard(false)}>
              Run
            </button>
          </div>
          <div className="maint-row">
            <div className="maint-id">
              <div className="maint-l">Prune everything</div>
              <div className="maint-s mono">
                containers, unused images, networks, build cache
              </div>
            </div>
            <button
              type="button"
              className="pill-btn is-danger"
              onClick={() => setConfirm('prune')}
            >
              Prune
            </button>
          </div>
          <div className="maint-row">
            <div className="maint-id">
              <div className="maint-l">Reset to factory</div>
              <div className="maint-s mono">re-create engine VM · keeps registries</div>
            </div>
            <button
              type="button"
              className="pill-btn is-danger"
              onClick={() => setConfirm('reset')}
            >
              Reset
            </button>
          </div>
          <div className="maint-row">
            <div className="maint-id">
              <div className="maint-l">Quit Dockman</div>
              <div className="maint-s mono">stop the engine and exit</div>
            </div>
            <button
              type="button"
              className="pill-btn"
              onClick={() => SystemCommands.quit().catch(() => undefined)}
            >
              Quit
            </button>
          </div>
        </div>
      </div>

      {confirm === 'prune' && (
        <ConfirmDialog
          title="Prune everything?"
          body="Stopped containers, unused images, unused networks and the entire build cache will be deleted. Running containers and named volumes are kept."
          confirmLabel="Prune"
          onConfirm={() =>
            SystemCommands.prune(
              runtimeFilter === 'podman' ? 'podman' : 'docker',
            ).catch(() => undefined)
          }
          onClose={() => setConfirm(null)}
        />
      )}
      {confirm === 'reset' && (
        <ConfirmDialog
          title="Reset to factory?"
          body="The engine VM is destroyed and re-created. Every container, image and volume inside it is lost. Registry logins are kept."
          confirmLabel="Reset"
          onConfirm={() => replayWizard(false)}
          onClose={() => setConfirm(null)}
        />
      )}
    </div>
  );
}
