// Command bar — 54px, fixed. Page title + subtitle, the palette trigger,
// three host meters and the runtime toggle that filters every list in the app.

import { useLocation } from 'react-router-dom';
import { Glyph } from '@/components/ui/Icon';
import { TABS } from '@/lib/tabs';
import { useCounts } from '@/hooks/useCounts';
import { useHostResources } from '@/hooks/useHostResources';
import { useAppStore } from '@/store/appStore';
import type { RuntimeFilter } from '@/types';

const RT_OPTIONS: { k: RuntimeFilter; l: string }[] = [
  { k: 'all', l: 'Both' },
  { k: 'docker', l: 'docker' },
  { k: 'podman', l: 'podman' },
];

interface CommandBarProps {
  onOpenPalette: () => void;
}

export function CommandBar({ onOpenPalette }: CommandBarProps) {
  const { pathname } = useLocation();
  const counts = useCounts();
  const res = useHostResources();
  const runtimeFilter = useAppStore((s) => s.runtimeFilter);
  const setRuntimeFilter = useAppStore((s) => s.setRuntimeFilter);
  const statusFilter = useAppStore((s) => s.statusFilter);

  const tab =
    TABS.find((t) => (t.path === '/' ? pathname === '/' : pathname.startsWith(t.path))) ??
    TABS[0];

  // Sections that own a list report how much of it is currently in view.
  const visible =
    statusFilter === 'all' ? counts.total : counts[statusFilter];
  const subtitles: Record<string, string> = {
    overview: 'all systems',
    containers: `${visible} of ${counts.total}`,
    images: `${counts.images} images`,
    volumes: `${counts.volumes} volumes`,
    networks: `${counts.networks} networks`,
    builds: `${counts.builds} builds`,
    binary: '2 runtimes',
    settings: '',
  };
  const title = tab.key === 'overview' ? 'Overview' : tab.label;

  const meters = [
    {
      k: 'CPU',
      v: `${Math.round(res.cpuPercent)}%`,
      pct: res.cpuPercent,
    },
    {
      k: 'RAM',
      v: `${res.memUsedGb.toFixed(1)}G`,
      pct: res.memPercent,
    },
    {
      k: 'DISK',
      v: `${Math.round(res.diskUsedGb)}G`,
      pct: res.diskPercent,
    },
  ];

  return (
    <header className="cmdbar">
      <div className="cmdbar-title">
        <span className="cmdbar-h1">{title}</span>
        {subtitles[tab.key] && (
          <span className="cmdbar-sub mono">{subtitles[tab.key]}</span>
        )}
      </div>

      <button type="button" className="cmdbar-search" onClick={onOpenPalette}>
        <Glyph name="search" size={13} sw={1.7} />
        <span className="cmdbar-search-ph">Search containers, images, logs…</span>
        <kbd className="cmdbar-kbd mono">⌘K</kbd>
      </button>

      <div className="cmdbar-trail">
        {meters.map((m) => (
          <div key={m.k} className="meter" title={`${m.k} ${m.v}`}>
            <div className="meter-row mono">
              <span>{m.k}</span>
              <span className="meter-val">{m.v}</span>
            </div>
            <div className="meter-track">
              <div
                className="meter-fill"
                style={{ width: `${Math.min(100, Math.max(0, m.pct))}%` }}
              />
            </div>
          </div>
        ))}

        <div className="cmdbar-divider" />

        <div className="rt-toggle" role="group" aria-label="Runtime filter">
          {RT_OPTIONS.map((o) => (
            <button
              key={o.k}
              type="button"
              className={`rt-toggle-btn ${runtimeFilter === o.k ? 'is-on' : ''}`}
              onClick={() => setRuntimeFilter(o.k)}
              aria-pressed={runtimeFilter === o.k}
            >
              {o.l}
            </button>
          ))}
        </div>
      </div>
    </header>
  );
}
