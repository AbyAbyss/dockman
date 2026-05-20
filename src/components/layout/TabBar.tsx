import { useLocation, useNavigate } from 'react-router-dom';
import { Glyph } from '@/components/ui/Icon';
import { TABS } from '@/lib/tabs';
import type { Counts } from '@/hooks/useCounts';
import type { TabPosition } from '@/types';

interface TabBarProps {
  counts: Counts;
  position: TabPosition;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

/** Tab navigation — renders as a sticky top strip or a left sidebar rail. */
export function TabBar({ counts, position, collapsed, onToggleCollapse }: TabBarProps) {
  const navigate = useNavigate();
  const { pathname } = useLocation();

  // Per-tab badge values (containers shows the running count, as in the design).
  const tabCount: Partial<Record<string, number>> = {
    containers: counts.running,
    images: counts.images,
    volumes: counts.volumes,
    networks: counts.networks,
    builds: counts.builds,
  };
  const isSide = position === 'left';

  return (
    <div className="tabbar">
      {isSide && (
        <button
          className="tab-collapse-btn"
          onClick={onToggleCollapse}
          title={collapsed ? 'Expand' : 'Collapse'}
          type="button"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            {collapsed ? <path d="M9 18l6-6-6-6" /> : <path d="M15 18l-6-6 6-6" />}
          </svg>
        </button>
      )}

      <div className="tabbar-inner">
        {TABS.map((t) => {
          const active =
            t.path === '/' ? pathname === '/' : pathname.startsWith(t.path);
          return (
            <button
              key={t.key}
              type="button"
              className={`tab ${active ? 'is-on' : ''}`}
              onClick={() => navigate(t.path)}
              title={collapsed ? t.label : undefined}
            >
              <Glyph name={t.icon} size={collapsed ? 16 : 13} />
              <span className="tab-label">{t.label}</span>
              {tabCount[t.key] !== undefined && (
                <span className="tab-badge mono">{tabCount[t.key]}</span>
              )}
            </button>
          );
        })}
      </div>

      {!isSide && (
        <div className="tabbar-trail">
          <button className="ghost-btn" type="button">
            <Glyph name="plus" size={13} /> New
          </button>
        </div>
      )}
    </div>
  );
}
