// Settings — runtime selection, engine resources, capabilities, registries,
// updates, appearance and the danger zone.

import { useState, type CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { BentoCard } from '@/components/ui/BentoCard';
import { Glyph } from '@/components/ui/Icon';
import { Pill } from '@/components/ui/Badge';
import { RuntimeBadge } from '@/components/ui/Runtime';
import { useAppStore } from '@/store/appStore';
import { useThemeStore } from '@/store/themeStore';
import { useRuntimes } from '@/hooks/useData';
import { SystemCommands } from '@/lib/commands';
import { useWizardStore } from '@/store/wizardStore';
import type {
  AccentName,
  PaletteName,
  RuntimeMeta,
  RuntimeName,
  TabPosition,
} from '@/types';

const REGISTRIES = [
  { name: 'Docker Hub', user: 'jordan-m', status: 'connected', icon: 'image' as const },
  { name: 'ghcr.io', user: 'jordan-m', status: 'connected', icon: 'extension' as const },
  { name: 'gcr.io', user: '—', status: 'disconnected', icon: 'cpu' as const },
  { name: 'self-hosted', user: 'admin', status: 'connected', icon: 'volume' as const },
];

const CHANGELOG = [
  { ver: '0.1.0', note: 'Builds panel · editable Dockerfile viewer' },
  { ver: '0.0.9', note: 'Binary manager · runtime detection' },
  { ver: '0.0.8', note: 'Bento dashboard · twin runtimes' },
];

const ACCENT_SWATCHES: [AccentName, string][] = [
  ['violet', '#a78bfa'],
  ['olive', '#a5b950'],
  ['terracotta', '#d97757'],
  ['cobalt', '#6aa5ff'],
];

function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  unit,
  onChange,
  note,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit: string;
  onChange: (v: number) => void;
  note: string;
}) {
  return (
    <div className="settings-slider">
      <div className="ss-h">
        <div className="ss-label">{label}</div>
        <div className="ss-val">
          <b>{value}</b> <span className="mono">{unit}</span>
        </div>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="range-input"
      />
      <div className="ss-note mono">{note}</div>
    </div>
  );
}

function Feature({
  label,
  sub,
  on,
  onChange,
}: {
  label: string;
  sub: string;
  on: boolean;
  onChange: () => void;
}) {
  return (
    <button className={`feat-row ${on ? 'is-on' : ''}`} type="button" onClick={onChange}>
      <div className="feat-meta">
        <div className="feat-label">{label}</div>
        <div className="feat-sub mono">{sub}</div>
      </div>
      <div className={`switch ${on ? 'is-on' : ''}`}>
        <div className="switch-knob" />
      </div>
    </button>
  );
}

export default function Settings() {
  const navigate = useNavigate();
  const theme = useThemeStore();
  const runtimeFilter = useAppStore((s) => s.runtimeFilter);
  const setRuntimeFilter = useAppStore((s) => s.setRuntimeFilter);
  const { runtimes } = useRuntimes();
  const replayWizard = useWizardStore((s) => s.setCompleted);

  const [cpu, setCpu] = useState(8);
  const [ram, setRam] = useState(8);
  const [swap, setSwap] = useState(1);
  const [disk, setDisk] = useState(60);
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

  return (
    <div className="bento">
      {/* Active runtime */}
      <BentoCard section="Runtimes" sectionIcon="extension" title="Active Runtime" span={6} headerAlign="left">
        <div className="settings-rt-row">
          {(Object.entries(runtimes) as [RuntimeName, RuntimeMeta][]).map(
            ([rt, meta]) => (
              <button
                key={rt}
                type="button"
                className={`settings-rt-card ${runtimeFilter === rt ? 'is-on' : ''}`}
                onClick={() => setRuntimeFilter(rt)}
                style={{ '--rt': meta.accent, '--rt-soft': meta.soft } as CSSProperties}
              >
                <div className="settings-rt-mark">
                  <Glyph name={rt === 'docker' ? 'container' : 'extension'} size={16} />
                </div>
                <div className="settings-rt-body">
                  <div className="settings-rt-name">{meta.name}</div>
                  <div className="settings-rt-v mono">
                    v{meta.version} · {meta.arch}
                  </div>
                </div>
                <div className="settings-rt-on">{runtimeFilter === rt ? '✓' : ''}</div>
              </button>
            ),
          )}
          <button
            type="button"
            className={`settings-rt-card both ${runtimeFilter === 'all' ? 'is-on' : ''}`}
            onClick={() => setRuntimeFilter('all')}
          >
            <div className="settings-rt-mark">
              <Glyph name="bolt" size={16} />
            </div>
            <div className="settings-rt-body">
              <div className="settings-rt-name">Both</div>
              <div className="settings-rt-v mono">unified view</div>
            </div>
            <div className="settings-rt-on">{runtimeFilter === 'all' ? '✓' : ''}</div>
          </button>
        </div>
        <div className="bin-opt-row" style={{ marginTop: 12 }}>
          <input
            type="checkbox"
            checked={theme.m1Fallback}
            onChange={(e) => theme.setM1Fallback(e.target.checked)}
          />
          <div>
            <div className="bin-opt-label">M1 auto-fallback</div>
            <div className="bin-opt-sub mono">
              If image fails on Podman (arch mismatch), retry on Docker (Rosetta)
            </div>
          </div>
        </div>
      </BentoCard>

      {/* Binary paths */}
      <BentoCard
        section="Paths"
        sectionIcon="extension"
        title="Binary Paths"
        span={6}
        headerAlign="left"
        headerAside={
          <button className="text-btn" type="button" onClick={() => navigate('/binaries')}>
            Open binary manager →
          </button>
        }
      >
        <div className="bin-paths">
          {(Object.entries(runtimes) as [RuntimeName, RuntimeMeta][]).map(
            ([rt, meta]) => (
              <div key={rt} className="bin-path-card">
                <RuntimeBadge rt={rt} size="sm" />
                <div className="bin-path-body">
                  <div className="bin-path-label">
                    {meta.name} {meta.found ? `· ${meta.version}` : '· not installed'}
                  </div>
                  <div className="bin-path-loc mono">{meta.path || '—'}</div>
                </div>
                <button className="text-btn" type="button">
                  Browse
                </button>
              </div>
            ),
          )}
        </div>
      </BentoCard>

      {/* Engine resources */}
      <BentoCard section="Engine" sectionIcon="settings" title="Resources" span={6} headerAlign="left">
        <Slider label="CPUs" value={cpu} min={1} max={12} unit="cores" onChange={setCpu} note="up to 12 available" />
        <Slider label="Memory" value={ram} min={1} max={16} unit="GB" onChange={setRam} note="of 16 GB host RAM" />
        <Slider label="Swap" value={swap} min={0} max={4} step={0.5} unit="GB" onChange={setSwap} note="virtual memory" />
        <Slider label="Disk image size" value={disk} min={16} max={256} step={4} unit="GB" onChange={setDisk} note="thin-provisioned" />
        <div className="settings-foot">
          <button className="action-btn primary" type="button">
            <Glyph name="restart" size={12} /> Apply &amp; restart engine
          </button>
        </div>
      </BentoCard>

      {/* Features */}
      <BentoCard section="Features" sectionIcon="extension" title="Capabilities" span={6} headerAlign="left">
        <div className="feat-grid">
          <Feature label="Compose v2" sub="docker compose subcommand" on={features.composeV2} onChange={() => toggleFeat('composeV2')} />
          <Feature label="BuildKit" sub="next-gen builder" on={features.buildKit} onChange={() => toggleFeat('buildKit')} />
          <Feature label="Rosetta" sub="x86_64 emulation on arm64" on={features.rosetta} onChange={() => toggleFeat('rosetta')} />
          <Feature label="Swarm mode" sub="cluster orchestration" on={features.swarm} onChange={() => toggleFeat('swarm')} />
          <Feature label="Kubernetes" sub="single-node K8s" on={features.kubernetes} onChange={() => toggleFeat('kubernetes')} />
          <Feature label="Experimental CLI" sub="bleeding-edge commands" on={features.experimentalCli} onChange={() => toggleFeat('experimentalCli')} />
          <Feature label="Auto-start engine" sub="on system login" on={features.autoStart} onChange={() => toggleFeat('autoStart')} />
          <Feature label="Send usage stats" sub="anonymous telemetry" on={features.sendUsage} onChange={() => toggleFeat('sendUsage')} />
        </div>
      </BentoCard>

      {/* Registries */}
      <BentoCard section="Identity" sectionIcon="extension" title="Registries" span={6} headerAlign="left">
        <div className="reg-list">
          {REGISTRIES.map((r) => (
            <div key={r.name} className="reg-row">
              <span className="reg-icon">
                <Glyph name={r.icon} size={13} />
              </span>
              <div className="reg-meta">
                <div className="reg-name">{r.name}</div>
                <div className="reg-user mono">{r.user}</div>
              </div>
              <Pill tone={r.status === 'connected' ? 'ok' : 'dim'}>{r.status}</Pill>
              <button className="text-btn" type="button">
                {r.status === 'connected' ? 'sign out' : 'sign in'}
              </button>
            </div>
          ))}
        </div>
      </BentoCard>

      {/* Updates */}
      <BentoCard section="Software" sectionIcon="restart" title="Updates" span={6} headerAlign="left">
        <div className="update-state">
          <div className="update-info">
            <div className="update-version">0.1.0</div>
            <div className="update-status mono">up to date · last checked 12m ago</div>
          </div>
          <Pill tone="ok">latest</Pill>
        </div>
        <div className="bc-section" style={{ marginTop: 8 }}>
          <span>Update channel</span>
        </div>
        <div className="fchip-row">
          {['stable', 'beta', 'edge'].map((c) => (
            <button key={c} type="button" className={`fchip ${c === 'stable' ? 'is-on' : ''}`}>
              {c}
            </button>
          ))}
        </div>
        <div className="changelog">
          <div className="bc-section">
            <span>Recent changes</span>
          </div>
          {CHANGELOG.map((c) => (
            <div key={c.ver} className="changelog-row mono">
              <span className="cl-ver">{c.ver}</span>
              <span className="cl-note">{c.note}</span>
            </div>
          ))}
        </div>
      </BentoCard>

      {/* Appearance */}
      <BentoCard section="Personalize" sectionIcon="settings" title="Appearance" span={8} headerAlign="left">
        <div className="appearance-grid">
          <div className="ap-group">
            <div className="bc-section">
              <span>Palette</span>
            </div>
            <div className="fchip-row">
              {(['ink', 'paper', 'slate'] as PaletteName[]).map((p) => (
                <button
                  key={p}
                  type="button"
                  className={`fchip ${theme.palette === p ? 'is-on' : ''}`}
                  onClick={() => theme.setPalette(p)}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
          <div className="ap-group">
            <div className="bc-section">
              <span>Accent</span>
            </div>
            <div className="swatch-row">
              {ACCENT_SWATCHES.map(([k, hex]) => (
                <button
                  key={k}
                  type="button"
                  className={`swatch ${theme.accent === k ? 'is-on' : ''}`}
                  onClick={() => theme.setAccent(k)}
                  style={{ background: hex }}
                  title={k}
                />
              ))}
            </div>
          </div>
          <div className="ap-group">
            <div className="bc-section">
              <span>Tab position</span>
            </div>
            <div className="fchip-row">
              {(
                [
                  { k: 'top', l: 'Top bar' },
                  { k: 'left', l: 'Left sidebar' },
                ] as { k: TabPosition; l: string }[]
              ).map((p) => (
                <button
                  key={p.k}
                  type="button"
                  className={`fchip ${theme.tabPosition === p.k ? 'is-on' : ''}`}
                  onClick={() => theme.setTabPosition(p.k)}
                >
                  <Glyph name={p.k === 'top' ? 'network' : 'container'} size={11} /> {p.l}
                </button>
              ))}
            </div>
          </div>
          <div className="ap-group">
            <div className="bc-section">
              <span>Tab labels</span>
            </div>
            <div className="fchip-row">
              <button
                type="button"
                className={`fchip ${!theme.tabCollapsed ? 'is-on' : ''}`}
                onClick={() => theme.setTabCollapsed(false)}
              >
                Show labels
              </button>
              <button
                type="button"
                className={`fchip ${theme.tabCollapsed ? 'is-on' : ''}`}
                onClick={() => theme.setTabCollapsed(true)}
              >
                Icons only
              </button>
            </div>
          </div>
          <div className="ap-group">
            <div className="bc-section">
              <span>Bento gap · {theme.gap}px</span>
            </div>
            <input
              type="range"
              min="6"
              max="28"
              value={theme.gap}
              onChange={(e) => theme.setGap(Number(e.target.value))}
              className="range-input"
            />
          </div>
          <div className="ap-group">
            <div className="bc-section">
              <span>Corner radius · {theme.radius}px</span>
            </div>
            <input
              type="range"
              min="4"
              max="28"
              value={theme.radius}
              onChange={(e) => theme.setRadius(Number(e.target.value))}
              className="range-input"
            />
          </div>
        </div>
      </BentoCard>

      {/* Danger zone */}
      <BentoCard section="Maintenance" sectionIcon="trash" title="Reset" span={4} headerAlign="left" className="bc-danger">
        <div className="danger-list">
          <div className="danger-row">
            <div>
              <div className="danger-label">Setup wizard</div>
              <div className="danger-sub mono">Replay the first-run guided setup</div>
            </div>
            <button
              className="action-btn"
              type="button"
              onClick={() => replayWizard(false)}
            >
              Run wizard
            </button>
          </div>
          <div className="danger-row">
            <div>
              <div className="danger-label">Prune everything</div>
              <div className="danger-sub mono">
                Containers, unused images, networks, build cache
              </div>
            </div>
            <button
              className="action-btn danger"
              type="button"
              onClick={() =>
                SystemCommands.prune(
                  runtimeFilter === 'podman' ? 'podman' : 'docker',
                ).catch(() => undefined)
              }
            >
              Prune
            </button>
          </div>
          <div className="danger-row">
            <div>
              <div className="danger-label">Reset to factory</div>
              <div className="danger-sub mono">Re-create engine VM · keeps registries</div>
            </div>
            <button className="action-btn danger" type="button">
              Reset
            </button>
          </div>
          <div className="danger-row">
            <div>
              <div className="danger-label">Quit Dockman</div>
              <div className="danger-sub mono">Stop the engine and exit</div>
            </div>
            <button
              className="action-btn"
              type="button"
              onClick={() => SystemCommands.quit().catch(() => undefined)}
            >
              Quit
            </button>
          </div>
        </div>
      </BentoCard>
    </div>
  );
}
