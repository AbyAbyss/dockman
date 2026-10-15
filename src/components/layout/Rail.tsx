// Left navigation rail — 74px, fixed. Replaces the old TopBar + TabBar
// arrangement: brand mark and the eight sections from `tabs.ts`.

import { useLocation, useNavigate } from 'react-router-dom';
import { Glyph } from '@/components/ui/Icon';
import { TABS } from '@/lib/tabs';

export function Rail({ collapsed = false }: { collapsed?: boolean }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();

  return (
    <nav className="rail" data-collapsed={collapsed ? 'true' : 'false'}>
      <div className="rail-brand">D</div>

      <div className="rail-items">
        {TABS.map((t) => {
          const active =
            t.path === '/' ? pathname === '/' : pathname.startsWith(t.path);
          return (
            <button
              key={t.key}
              type="button"
              className={`rail-item ${active ? 'is-on' : ''}`}
              onClick={() => navigate(t.path)}
              title={t.label}
              aria-current={active ? 'page' : undefined}
            >
              <span className="rail-icon">
                <Glyph name={t.icon} size={15} />
              </span>
              <span className="rail-label">{t.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
