import { useEffect, useRef, type CSSProperties } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { TopBar } from '@/components/layout/TopBar';
import { TabBar } from '@/components/layout/TabBar';
import { TABS } from '@/lib/tabs';
import { SystemCommands } from '@/lib/commands';
import { useCounts } from '@/hooks/useCounts';
import { useAppStore } from '@/store/appStore';
import { ACCENTS, PALETTES, useThemeStore } from '@/store/themeStore';
import { useWizardStore } from '@/store/wizardStore';
import { SetupWizard } from '@/components/wizard/SetupWizard';
import { RUNTIME_BRAND } from '@/data/runtimes';
import { Glyph } from '@/components/ui/Icon';

/** Application shell: theme tokens, top bar, tab navigation and the routed
 *  page outlet. */
export default function App() {
  const theme = useThemeStore();
  const runtimeFilter = useAppStore((s) => s.runtimeFilter);
  const refresh = useAppStore((s) => s.refresh);
  const error = useAppStore((s) => s.error);
  const clearError = useAppStore((s) => s.clearError);
  const counts = useCounts();
  const wizardCompleted = useWizardStore((s) => s.completed);
  const location = useLocation();
  const navigate = useNavigate();

  const pal = PALETTES[theme.palette];
  const acc = ACCENTS[theme.accent];

  // Window translucency: native vibrancy (applied by the Rust side) provides the
  // blur; this CSS alpha controls how much of it shows. Disabled → fully opaque.
  const translucency = theme.translucent ? theme.translucency : 0;
  const mix = (c: string) =>
    translucency === 0
      ? c
      : `color-mix(in oklab, ${c} ${100 - translucency}%, transparent)`;
  const winBg = mix(pal.bg);

  // Poll the container inventory and stats every 5 seconds.
  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
  }, [refresh]);

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
    '--rt-docker': RUNTIME_BRAND.docker.accent,
    '--rt-docker-soft': RUNTIME_BRAND.docker.soft,
    '--rt-podman': RUNTIME_BRAND.podman.accent,
    '--rt-podman-soft': RUNTIME_BRAND.podman.soft,
    '--ok': acc.hex,
    '--warn': '#e0b265',
    '--bad': '#e07a5f',
    '--info': '#8ab4f8',
    '--gap': `${theme.gap}px`,
    '--radius': `${theme.radius}px`,
    '--mono': "'Geist Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
  };

  return (
    <div
      className="dockman-root"
      data-theme={theme.palette}
      data-tab-pos={theme.tabPosition}
      data-tab-collapsed={theme.tabCollapsed ? 'true' : 'false'}
      data-rt={runtimeFilter}
      style={rootStyle as CSSProperties}
    >
      <TopBar />
      {error && (
        <div className="app-error mono" role="alert">
          <span>{error}</span>
          <button type="button" className="iconbtn" aria-label="Dismiss" onClick={clearError}>
            <Glyph name="close" size={12} />
          </button>
        </div>
      )}
      <div className="layout-body">
        <TabBar
          counts={counts}
          position={theme.tabPosition}
          collapsed={theme.tabCollapsed}
          onToggleCollapse={() => theme.setTabCollapsed(!theme.tabCollapsed)}
        />
        <main className="stage" key={location.pathname}>
          <Outlet />
        </main>
      </div>
      {!wizardCompleted && <SetupWizard />}
    </div>
  );
}
