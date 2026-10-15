// Settings — runtime selection, appearance, version and maintenance.

import { useState } from 'react';
import { Glyph } from '@/components/ui/Icon';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useAppStore } from '@/store/appStore';
import { ACCENTS, MODES, PALETTES, useThemeStore } from '@/store/themeStore';
import { useWizardStore } from '@/store/wizardStore';
import { useRuntimes } from '@/hooks/useData';
import { SystemCommands } from '@/lib/commands';
import { APP_VERSION, RELEASES_URL } from '@/lib/version';
import type {
  AccentName,
  PaletteName,
  RuntimeFilter,
  RuntimeName,
  ThemeMode,
} from '@/types';

export default function Settings() {
  const theme = useThemeStore();
  const runtimeFilter = useAppStore((s) => s.runtimeFilter);
  const setRuntimeFilter = useAppStore((s) => s.setRuntimeFilter);
  const { runtimes } = useRuntimes();
  const replayWizard = useWizardStore((s) => s.setCompleted);

  const [confirmPrune, setConfirmPrune] = useState(false);

  const runtimeRows: { k: RuntimeFilter; name: string; sub: string; rt?: RuntimeName }[] =
    [
      {
        k: 'docker',
        name: 'Docker',
        sub: runtimes.docker.found
          ? `v${runtimes.docker.version} · ${runtimes.docker.path}`
          : 'not installed',
        rt: 'docker',
      },
      {
        k: 'podman',
        name: 'Podman',
        sub: runtimes.podman.found
          ? `v${runtimes.podman.version} · ${runtimes.podman.path}`
          : 'not installed',
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
          <div className="bin-sub mono">
            images without an arm64 variant are re-run under amd64 emulation
            automatically; the row shows an “emulated” chip
          </div>
        </div>

        {/* 2 — Appearance */}
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

          {theme.mode === 'playful' && (
            <div className="bin-sub mono">
              Playful ships its own palette — the choices below apply to Serious.
            </div>
          )}

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

        {/* 3 — About */}
        <div className="card set-card">
          <div className="card-title">About</div>
          <div className="set-version">
            <span className="set-version-n">{APP_VERSION}</span>
          </div>
          <div className="bin-sub mono">new versions are published on GitHub</div>
          <div className="pill-row">
            <button
              type="button"
              className="pill-btn"
              onClick={() => SystemCommands.openUrl(RELEASES_URL).catch(() => undefined)}
            >
              Open releases
            </button>
          </div>
        </div>

        {/* 4 — Maintenance */}
        <div className="card set-card set-danger">
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
              onClick={() => setConfirmPrune(true)}
            >
              Prune
            </button>
          </div>
          <div className="maint-row">
            <div className="maint-id">
              <div className="maint-l">Quit Dockman</div>
              <div className="maint-s mono">exit the app · engines keep running</div>
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

      {confirmPrune && (
        <ConfirmDialog
          title="Prune everything?"
          body="Stopped containers, unused images, unused networks and the entire build cache will be deleted. Running containers and named volumes are kept."
          confirmLabel="Prune"
          onConfirm={() =>
            SystemCommands.prune(
              runtimeFilter === 'podman' ? 'podman' : 'docker',
            ).catch(() => undefined)
          }
          onClose={() => setConfirmPrune(false)}
        />
      )}
    </div>
  );
}
