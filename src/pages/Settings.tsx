// Settings — runtime selection, binary paths, engine resources and facts,
// registry logins, app updates, appearance and maintenance.

import { useEffect, useState, type CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { BentoCard } from '@/components/ui/BentoCard';
import { Glyph } from '@/components/ui/Icon';
import { Pill } from '@/components/ui/Badge';
import { RuntimeBadge } from '@/components/ui/Runtime';
import { useAppStore } from '@/store/appStore';
import { useThemeStore } from '@/store/themeStore';
import { logActivity } from '@/store/activityStore';
import { useEngineInfo, useHostInfo, useRuntimes } from '@/hooks/useData';
import { useResource } from '@/hooks/useResource';
import {
  HostCommands,
  RuntimeCommands,
  SystemCommands,
  runtimesFor,
  type EngineResources,
  type UpdateInfo,
} from '@/lib/commands';
import { formatBytes } from '@/lib/parsers';
import { useWizardStore } from '@/store/wizardStore';
import type {
  AccentName,
  PaletteName,
  RuntimeMeta,
  RuntimeName,
  TabPosition,
} from '@/types';

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
  disabled,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit: string;
  onChange: (v: number) => void;
  note: string;
  disabled?: boolean;
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
        disabled={disabled}
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

// ─── Engine resources ────────────────────────────────────────────────────────

function ResourcesCard({ rt }: { rt: RuntimeName }) {
  const res = useResource<EngineResources | null>(
    () => HostCommands.engineResources(rt).catch(() => null),
    null,
    [rt],
  );
  const [cpus, setCpus] = useState(0);
  const [mem, setMem] = useState(0);
  const [disk, setDisk] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (res.data) {
      setCpus(res.data.cpus);
      setMem(res.data.memoryMb);
      setDisk(res.data.diskGb);
    }
  }, [res.data]);

  const apply = async () => {
    setBusy(true);
    setMsg('Stopping the machine, applying, starting it again…');
    try {
      await HostCommands.setMachineResources(cpus, mem, disk);
      setMsg('Applied. The Podman machine is back up.');
      logActivity('restart', 'podman', 'podman machine', `${cpus} cpus · ${mem} MB · ${disk} GB`);
      res.refetch();
    } catch (e) {
      setMsg(String(e));
    }
    setBusy(false);
  };

  const r = res.data;
  const dirty = r ? cpus !== r.cpus || mem !== r.memoryMb || disk !== r.diskGb : false;

  return (
    <BentoCard section="Engine" sectionIcon="settings" title={`Resources · ${rt}`} span={6} headerAlign="left">
      {!r ? (
        <div className="empty" style={{ padding: '20px 8px' }}>
          <Glyph name="cpu" size={20} />
          <div>{res.loading ? 'Reading engine resources…' : `${rt} engine is not reachable.`}</div>
        </div>
      ) : r.editable ? (
        <>
          <Slider label="CPUs" value={cpus} min={1} max={Math.max(16, r.cpus)} unit="cores" onChange={setCpus} note={r.source} />
          <Slider label="Memory" value={mem} min={1024} max={Math.max(32768, r.memoryMb)} step={512} unit="MB" onChange={setMem} note="VM memory" />
          <Slider label="Disk" value={disk} min={r.diskGb} max={Math.max(256, r.diskGb)} step={4} unit="GB" onChange={setDisk} note="can only grow" />
          <div className="settings-foot">
            <button className="action-btn primary" type="button" onClick={apply} disabled={!dirty || busy}>
              <Glyph name="restart" size={12} /> {busy ? 'Applying…' : 'Apply & restart machine'}
            </button>
          </div>
          {msg && <div className="rcm-note mono">{msg}</div>}
        </>
      ) : (
        <>
          <div className="fact-grid">
            <div className="fact">
              <div className="fact-k">CPUs</div>
              <div className="fact-v">{r.cpus}</div>
            </div>
            <div className="fact">
              <div className="fact-k">Memory</div>
              <div className="fact-v">{formatBytes(r.memoryMb * 1024 * 1024)}</div>
            </div>
          </div>
          <div className="ss-note mono" style={{ marginTop: 8 }}>
            {r.source}. {rt === 'docker'
              ? 'Docker engines are sized in the engine app (Docker Desktop, OrbStack, Colima) or by the host.'
              : 'Native Podman uses the host directly.'}
          </div>
        </>
      )}
    </BentoCard>
  );
}

// ─── Registries ──────────────────────────────────────────────────────────────

function RegistriesCard({ rt }: { rt: RuntimeName }) {
  const logins = useResource(() => HostCommands.registryLogins(), [], []);
  const [form, setForm] = useState({ registry: 'docker.io', user: '', password: '' });
  const [showForm, setShowForm] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const login = async () => {
    if (!form.registry || !form.user || !form.password) return;
    setBusy(true);
    setMsg(null);
    try {
      await HostCommands.registryLogin(rt, form.registry, form.user, form.password);
      setMsg(`Signed in to ${form.registry} with ${rt}`);
      setForm((f) => ({ ...f, password: '' }));
      setShowForm(false);
      logins.refetch();
    } catch (e) {
      setMsg(String(e));
    }
    setBusy(false);
  };

  const logout = async (runtime: RuntimeName, registry: string) => {
    setMsg(null);
    try {
      await HostCommands.registryLogout(runtime, registry);
      setMsg(`Signed out of ${registry}`);
      logins.refetch();
    } catch (e) {
      setMsg(String(e));
    }
  };

  return (
    <BentoCard
      section="Identity"
      sectionIcon="extension"
      title="Registries"
      span={6}
      headerAlign="left"
      headerAside={
        <button className="text-btn" type="button" onClick={() => setShowForm((v) => !v)}>
          {showForm ? 'cancel' : `sign in with ${rt} →`}
        </button>
      }
    >
      {showForm && (
        <div className="login-form">
          <div className="pull-input">
            <Glyph name="network" size={13} />
            <input value={form.registry} onChange={(e) => setForm({ ...form, registry: e.target.value })} placeholder="registry, e.g. ghcr.io" />
          </div>
          <div className="pull-input">
            <Glyph name="extension" size={13} />
            <input value={form.user} onChange={(e) => setForm({ ...form, user: e.target.value })} placeholder="username" />
          </div>
          <div className="pull-input">
            <Glyph name="settings" size={13} />
            <input
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              placeholder="password or token"
              onKeyDown={(e) => {
                if (e.key === 'Enter') login();
              }}
            />
          </div>
          <button className="action-btn primary" type="button" onClick={login} disabled={busy}>
            {busy ? '…' : 'Sign in'}
          </button>
        </div>
      )}
      {msg && <div className="rcm-note mono" style={{ marginTop: 8 }}>{msg}</div>}
      {logins.data.length === 0 ? (
        <div className="empty" style={{ padding: '20px 8px' }}>
          <Glyph name="extension" size={20} />
          <div>No registry credentials stored for Docker or Podman.</div>
        </div>
      ) : (
        <div className="reg-list">
          {logins.data.map((r) => (
            <div key={r.runtime + r.registry} className="reg-row">
              <span className="reg-icon">
                <Glyph name="image" size={13} />
              </span>
              <div className="reg-meta">
                <div className="reg-name">{r.registry}</div>
                <div className="reg-user mono" title={r.file}>
                  {r.runtime} credentials
                </div>
              </div>
              <Pill tone="ok">signed in</Pill>
              <button className="text-btn" type="button" onClick={() => logout(r.runtime, r.registry)}>
                sign out
              </button>
            </div>
          ))}
        </div>
      )}
    </BentoCard>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function Settings() {
  const navigate = useNavigate();
  const theme = useThemeStore();
  const runtimeFilter = useAppStore((s) => s.runtimeFilter);
  const setRuntimeFilter = useAppStore((s) => s.setRuntimeFilter);
  const { runtimes, refetch: refetchRuntimes } = useRuntimes();
  const host = useHostInfo().data;
  const engines = useEngineInfo(runtimeFilter);
  const replayWizard = useWizardStore((s) => s.setCompleted);

  const primary: RuntimeName = runtimeFilter === 'podman' ? 'podman' : 'docker';

  const [autoStart, setAutoStart] = useState<boolean | null>(null);
  const [pathMsg, setPathMsg] = useState<string | null>(null);
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [updateMsg, setUpdateMsg] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [pruneMsg, setPruneMsg] = useState<string | null>(null);

  useEffect(() => {
    RuntimeCommands.getStartOnLogin()
      .then(setAutoStart)
      .catch(() => setAutoStart(false));
  }, []);

  const toggleAutoStart = () => {
    const next = !autoStart;
    RuntimeCommands.setStartOnLogin(next)
      .then(() => setAutoStart(next))
      .catch(() => undefined);
  };

  const browsePath = (rt: RuntimeName) => {
    HostCommands.pickFile()
      .then(async (p) => {
        if (!p) return;
        await RuntimeCommands.setPath(rt, p);
        setPathMsg(`${rt} now uses ${p}`);
        refetchRuntimes();
      })
      .catch((e) => setPathMsg(String(e)));
  };

  const clearPath = (rt: RuntimeName) => {
    RuntimeCommands.setPath(rt, '')
      .then(() => {
        setPathMsg(`${rt} path reset to auto-detect`);
        refetchRuntimes();
      })
      .catch((e) => setPathMsg(String(e)));
  };

  const checkUpdate = () => {
    setChecking(true);
    setUpdateMsg(null);
    HostCommands.checkForUpdate()
      .then(setUpdate)
      .catch((e) => setUpdateMsg(String(e)))
      .finally(() => setChecking(false));
  };

  const pruneAll = async () => {
    setPruneMsg(null);
    for (const rt of runtimesFor(runtimeFilter)) {
      try {
        const out = await SystemCommands.prune(rt);
        const line = out.split('\n').find((l) => l.toLowerCase().includes('reclaimed')) ?? 'done';
        setPruneMsg((m) => `${m ? `${m}\n` : ''}${rt}: ${line.trim()}`);
        logActivity('prune', rt, 'system', line.trim());
      } catch (e) {
        setPruneMsg((m) => `${m ? `${m}\n` : ''}${rt}: ${String(e)}`);
      }
    }
  };

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
                    {meta.found ? `v${meta.version} · ${meta.arch}` : 'not installed'}
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
            <div className="bin-opt-label">Architecture auto-fallback</div>
            <div className="bin-opt-sub mono">
              If an image fails on Podman because of a CPU architecture mismatch, retry on
              Docker with --platform (emulation)
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
                <button className="text-btn" type="button" onClick={() => browsePath(rt)}>
                  Browse
                </button>
                <button className="text-btn" type="button" onClick={() => clearPath(rt)}>
                  Auto
                </button>
              </div>
            ),
          )}
        </div>
        {pathMsg && <div className="rcm-note mono" style={{ marginTop: 8 }}>{pathMsg}</div>}
      </BentoCard>

      <ResourcesCard rt={primary} />

      {/* Engine facts */}
      <BentoCard section="Engine" sectionIcon="cpu" title="Engine facts" span={6} headerAlign="left">
        {engines.data.length === 0 ? (
          <div className="empty" style={{ padding: '20px 8px' }}>
            <Glyph name="cpu" size={20} />
            <div>{engines.loading ? 'Reading engine info…' : 'No engine is reachable right now.'}</div>
          </div>
        ) : (
          engines.data.map((e) => (
            <div key={e.runtime} style={{ marginBottom: 10 }}>
              <div className="bc-section" style={{ marginBottom: 6 }}>
                <RuntimeBadge rt={e.runtime} size="xs" />
                <span>v{e.serverVersion}</span>
              </div>
              <div className="fact-grid">
                <div className="fact"><div className="fact-k">OS</div><div className="fact-v" title={e.operatingSystem}>{e.operatingSystem || e.osType}</div></div>
                <div className="fact"><div className="fact-k">Arch</div><div className="fact-v">{e.architecture}</div></div>
                <div className="fact"><div className="fact-k">Storage</div><div className="fact-v">{e.storageDriver}</div></div>
                <div className="fact"><div className="fact-k">cgroups</div><div className="fact-v">v{e.cgroupVersion || '?'}</div></div>
                <div className="fact"><div className="fact-k">Rootless</div><div className="fact-v">{e.rootless ? 'yes' : 'no'}</div></div>
                <div className="fact"><div className="fact-k">Running</div><div className="fact-v">{e.containersRunning} containers · {e.images} images</div></div>
              </div>
            </div>
          ))
        )}
        <div className="feat-grid" style={{ marginTop: 8 }}>
          <Feature
            label="Start Dockman on login"
            sub={autoStart === null ? 'checking…' : 'launches minimized'}
            on={!!autoStart}
            onChange={toggleAutoStart}
          />
        </div>
      </BentoCard>

      <RegistriesCard rt={primary} />

      {/* Updates */}
      <BentoCard section="Software" sectionIcon="restart" title="Updates" span={6} headerAlign="left">
        <div className="update-state">
          <div className="update-info">
            <div className="update-version">{host?.appVersion ?? '…'}</div>
            <div className="update-status mono">
              {update
                ? update.updateAvailable
                  ? `v${update.latest} is available`
                  : `up to date · latest is v${update.latest}`
                : 'not checked yet'}
            </div>
          </div>
          {update && <Pill tone={update.updateAvailable ? 'warn' : 'ok'}>{update.updateAvailable ? 'update' : 'latest'}</Pill>}
        </div>
        <div className="det-actions">
          <button className="action-btn" type="button" onClick={checkUpdate} disabled={checking}>
            <Glyph name="restart" size={12} /> {checking ? 'Checking…' : 'Check for updates'}
          </button>
          {update?.updateAvailable && (
            <button className="action-btn primary" type="button" onClick={() => SystemCommands.openUrl(update.url)}>
              Download v{update.latest} <Glyph name="arrow" size={12} />
            </button>
          )}
        </div>
        {updateMsg && <div className="rcm-error mono">{updateMsg}</div>}
        <div className="ss-note mono" style={{ marginTop: 8 }}>
          Checks github.com/AbyAbyss/dockman/releases. Installers are not signed yet; see the
          first-launch notes in the README.
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
          <div className="ap-group">
            <div className="bc-section">
              <span>
                Window translucency
                {theme.translucent ? ` · ${theme.translucency}%` : ''}
              </span>
            </div>
            <div className="fchip-row">
              <button
                type="button"
                className={`fchip ${!theme.translucent ? 'is-on' : ''}`}
                onClick={() => theme.setTranslucent(false)}
              >
                Off
              </button>
              <button
                type="button"
                className={`fchip ${theme.translucent ? 'is-on' : ''}`}
                onClick={() => theme.setTranslucent(true)}
              >
                On
              </button>
            </div>
            {theme.translucent && (
              <input
                type="range"
                min="10"
                max="80"
                value={theme.translucency}
                onChange={(e) => theme.setTranslucency(Number(e.target.value))}
                className="range-input"
                style={{ marginTop: 10 }}
              />
            )}
          </div>
        </div>
      </BentoCard>

      {/* Maintenance */}
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
                Stopped containers, dangling images, unused networks, build cache
                {runtimeFilter === 'all' ? ' · both runtimes' : ` · ${runtimeFilter}`}
              </div>
            </div>
            <button className="action-btn danger" type="button" onClick={pruneAll}>
              Prune
            </button>
          </div>
          {pruneMsg && <div className="rcm-note mono">{pruneMsg}</div>}
          <div className="danger-row">
            <div>
              <div className="danger-label">Quit Dockman</div>
              <div className="danger-sub mono">Engines keep running</div>
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
