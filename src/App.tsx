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
import { ACCENTS, MODES, PALETTES, useThemeStore } from '@/store/themeStore';
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
  const winBg = mix(pal.bg);

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

  const rootStyle: Record<string, string> = {
    '--bg': pal.bg,
    '--surface': mix(pal.surface),
    '--text': pal.text,
    '--dim': pal.dim,
    '--line': pal.line,
    '--subtle': pal.subtle,
    '--tint': pal.tint,
    '--accent': acc.hex,
    '--accent-soft': acc.soft,
    '--rt-docker': RUNTIMES.docker.accent,
    '--rt-docker-soft': RUNTIMES.docker.soft,
    '--rt-podman': RUNTIMES.podman.accent,
    '--rt-podman-soft': RUNTIMES.podman.soft,
    '--ok': acc.hex,
    '--warn': '#e0b265',
    '--bad': '#e07a5f',
    '--info': '#8ab4f8',
    '--gap': `${theme.gap}px`,
    '--radius': `${theme.radius}px`,
    '--mono': "'Geist Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
    '--sans': "'Geist', ui-sans-serif, system-ui, -apple-system, sans-serif",

    // Theme mode — shape, density and motion. Every screen reads these.
    '--r-card': `${mode.rCard}px`,
    '--r-ctl': `${mode.rCtl}px`,
    '--r-pill': `${mode.rPill}px`,
    '--r-chip': `${mode.rChip}px`,
    '--row-h': `${mode.rowH}px`,
    '--group-h': `${mode.groupH}px`,
    '--pad-y': `${mode.padY}px`,
    '--pad-x': `${mode.padX}px`,
    '--dur': `${mode.dur}ms`,
    '--ease': mode.ease,
    '--card-shadow': mode.cardShadow,
    '--lift': mode.lift,
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
