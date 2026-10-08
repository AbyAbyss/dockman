import { useEffect, useRef } from 'react';
import { Glyph } from '@/components/ui/Icon';
import { RuntimeSwitcher } from '@/components/ui/Runtime';
import { useAppStore } from '@/store/appStore';
import { useHostInfo } from '@/hooks/useData';
import { refreshAll } from '@/hooks/useResource';

/** Sticky top bar — brand mark, global search, runtime switcher, refresh. */
export function TopBar() {
  const query = useAppStore((s) => s.query);
  const setQuery = useAppStore((s) => s.setQuery);
  const runtimeFilter = useAppStore((s) => s.runtimeFilter);
  const setRuntimeFilter = useAppStore((s) => s.setRuntimeFilter);
  const refresh = useAppStore((s) => s.refresh);
  const loading = useAppStore((s) => s.loading);
  const host = useHostInfo().data;
  const searchRef = useRef<HTMLInputElement>(null);

  // ⌘K / Ctrl+K focuses the search box.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const refreshEverything = () => {
    refresh();
    refreshAll();
  };

  return (
    <header className="topbar">
      <div className="brand">
        <div className="brand-mark">
          <svg
            viewBox="0 0 24 24"
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinejoin="round"
            strokeLinecap="round"
          >
            <rect x="3" y="9" width="5" height="5" rx="1" />
            <rect x="9.5" y="9" width="5" height="5" rx="1" />
            <rect x="16" y="9" width="5" height="5" rx="1" />
            <rect x="9.5" y="3" width="5" height="5" rx="1" />
            <path d="M3 17h18" />
          </svg>
        </div>
        <b>Dockman</b>
        {host && <span className="brand-tag mono">v{host.appVersion}</span>}
      </div>

      <div className="search">
        <Glyph name="search" size={14} />
        <input
          ref={searchRef}
          placeholder="Search containers, images, volumes…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <kbd>⌘K</kbd>
      </div>

      <div className="top-actions">
        <RuntimeSwitcher active={runtimeFilter} setActive={setRuntimeFilter} />
        <button
          className="ghost-btn"
          title="Refresh everything"
          type="button"
          onClick={refreshEverything}
          disabled={loading}
        >
          <Glyph name="restart" size={13} />
        </button>
      </div>
    </header>
  );
}
