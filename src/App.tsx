import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Rail } from '@/components/layout/Rail';
import { CommandBar } from '@/components/layout/CommandBar';
import { StatusBar } from '@/components/layout/StatusBar';
import { CommandPalette } from '@/components/ui/CommandPalette';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { TABS } from '@/lib/tabs';
import { SystemCommands } from '@/lib/commands';
import { useAppStore } from '@/store/appStore';
import {
  ACCENTS,
  MODES,
  PALETTES,
  PLAYFUL_PALETTE,
  useThemeStore,
} from '@/store/themeStore';
import { useWizardStore } from '@/store/wizardStore';
import { SetupWizard } from '@/components/wizard/SetupWizard';
import { RUNTIMES } from '@/data/seed';

/** Application shell: theme tokens, top bar, tab navigation and the routed
 *  page outlet. */
export default function App() {
  const theme = useThemeStore();
  const runtimeFilter = useAppStore((s) => s.runtimeFilter);
  const live = useAppStore((s) => s.live);
  const refresh = useAppStore((s) => s.refresh);
  const driftCpu = useAppStore((s) => s.driftCpu);
  const stopAllRunning = useAppStore((s) => s.stopAllRunning);
  const runningCount = useAppStore(
    (s) => s.containers.filter((c) => c.status === 'running').length,
  );
  const wizardCompleted = useWizardStore((s) => s.completed);
  const location = useLocation();
  const navigate = useNavigate();

  const [paletteOpen, setPaletteOpen] = useState(false);
  const [confirmStopAll, setConfirmStopAll] = useState(false);

  const pal = PALETTES[theme.palette];
  const acc = ACCENTS[theme.accent];
  const mode = MODES[theme.mode];

  // Window translucency: native vibrancy (applied by the Rust side) provides the
  // blur; this CSS alpha controls how much of it shows. Disabled → fully opaque.
  const translucency = theme.translucent ? theme.translucency : 0;
  const mix = (c: string) =>
    translucency === 0
      ? c
      : `color-mix(in oklab, ${c} ${100 - translucency}%, transparent)`;
  // Playful is opaque cream by design; translucency only applies to Serious.
  const winBg = theme.mode === 'playful' ? PLAYFUL_PALETTE.bg : mix(pal.bg);

  // Live mode: poll the real container inventory. Seed mode: gentle CPU drift
  // so the prototype UI still feels alive.
  useEffect(() => {
    if (live) {
      refresh();
      const id = setInterval(refresh, 5000);
      return () => clearInterval(id);
    }
    const id = setInterval(driftCpu, 2000);
    return () => clearInterval(id);
  }, [live, refresh, driftCpu]);

  // Honour the "default tab" preference once, on first load.
  const redirected = useRef(false);
  useEffect(() => {
    if (redirected.current) return;
    redirected.current = true;
    if (location.pathname === '/' && theme.defaultTab !== 'overview') {
      const tab = TABS.find((t) => t.key === theme.defaultTab);
      if (tab) navigate(tab.path, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mirror the window fill onto <html> so <body> + overscroll match the shell.
  useEffect(() => {
    document.documentElement.style.setProperty('--win-bg', winBg);
  }, [winBg]);

  // Apply or clear the native macOS vibrancy / Windows acrylic backing.
  useEffect(() => {
    SystemCommands.setTranslucent(theme.translucent).catch(() => undefined);
  }, [theme.translucent]);

  // ⌘K / Ctrl-K opens the palette from anywhere in the app.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Playful carries its own palette, so it replaces the palette / accent
  // choice outright — those pickers only apply to Serious.
  const pf = theme.mode === 'playful';
  const P = PLAYFUL_PALETTE;

  const rootStyle: Record<string, string> = {
    '--bg': pf ? P.bg : pal.bg,
    '--surface': pf ? P.surface : mix(pal.surface),
    '--text': pf ? P.text : pal.text,
    '--dim': pf ? P.dim : pal.dim,
    '--line': pf ? P.line : pal.line,
    '--subtle': pf ? P.subtle : pal.subtle,
    '--tint': pf ? P.tint : pal.tint,
    '--accent': pf ? P.accent : acc.hex,
    '--accent-soft': pf ? P.accentSoft : acc.soft,
    '--rt-docker': pf ? P.rtDocker : RUNTIMES.docker.accent,
    '--rt-docker-soft': RUNTIMES.docker.soft,
    '--rt-podman': pf ? P.rtPodman : RUNTIMES.podman.accent,
    '--rt-podman-soft': RUNTIMES.podman.soft,
    '--ok': pf ? P.accent : acc.hex,
    '--warn': pf ? P.warn : '#e0b265',
    '--bad': pf ? P.bad : '#e07a5f',
    '--info': pf ? P.info : '#8ab4f8',
    '--gap': `${theme.gap}px`,
    '--radius': `${theme.radius}px`,
    '--mono': pf
      ? "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace"
      : "'Geist Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
    '--sans': pf
      ? "'Outfit', ui-sans-serif, system-ui, sans-serif"
      : "'Geist', ui-sans-serif, system-ui, -apple-system, sans-serif",

    // Theme mode — shape, density and motion. Every screen reads these.
    '--r-card': `${mode.rCard}px`,
    '--r-ctl': `${mode.rCtl}px`,
    '--r-pill': `${mode.rPill}px`,
    '--r-chip': `${mode.rChip}px`,
    '--row-h': `${mode.rowH}px`,
    '--group-h': `${mode.groupH}px`,
    '--pad-y': `${mode.padY}px`,
    '--pad-x': `${mode.padX}px`,
    '--bw': `${mode.bw}px`,
    '--bw-card': `${mode.bwCard}px`,
    '--dur': `${mode.dur}ms`,
    '--ease': mode.ease,
    '--card-shadow': mode.cardShadow,
    '--btn-shadow': mode.btnShadow,
    '--btn-shadow-active': mode.btnShadowActive,
  };

  return (
    <div
      className="dockman-root"
      data-theme={theme.palette}
      data-mode={theme.mode}
      data-tab-pos={theme.tabPosition}
      data-tab-collapsed={theme.tabCollapsed ? 'true' : 'false'}
      data-rt={runtimeFilter}
      style={rootStyle as CSSProperties}
    >
      <div className="shell">
        <Rail collapsed={theme.tabCollapsed} />
        <div className="shell-main">
          <CommandBar onOpenPalette={() => setPaletteOpen(true)} />
          <main className="stage" key={location.pathname}>
            <Outlet />
          </main>
          <StatusBar />
        </div>
      </div>

      {paletteOpen && (
        <CommandPalette
          onClose={() => setPaletteOpen(false)}
          onStopAllRunning={() => setConfirmStopAll(true)}
        />
      )}
      {confirmStopAll && (
        <ConfirmDialog
          title="Stop all running containers?"
          body={`${runningCount} container${runningCount === 1 ? '' : 's'} will be stopped. Compose stacks stay defined — this does not remove anything.`}
          confirmLabel={`Stop ${runningCount}`}
          onConfirm={stopAllRunning}
          onClose={() => setConfirmStopAll(false)}
        />
      )}
      {!wizardCompleted && <SetupWizard />}
    </div>
  );
}
