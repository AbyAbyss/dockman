import { Glyph } from '@/components/ui/Icon';
import { RuntimeSwitcher } from '@/components/ui/Runtime';
import { useAppStore } from '@/store/appStore';

/** Sticky top bar — brand mark, global search, runtime switcher. */
export function TopBar() {
  const query = useAppStore((s) => s.query);
  const setQuery = useAppStore((s) => s.setQuery);
  const runtimeFilter = useAppStore((s) => s.runtimeFilter);
  const setRuntimeFilter = useAppStore((s) => s.setRuntimeFilter);

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
        <span className="brand-tag mono">v0.1</span>
      </div>

      <div className="search">
        <Glyph name="search" size={14} />
        <input
          placeholder="Search containers, images, logs…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <kbd>⌘K</kbd>
      </div>

      <div className="top-actions">
        <RuntimeSwitcher active={runtimeFilter} setActive={setRuntimeFilter} />
        <button className="ghost-btn" title="Refresh" type="button">
          <Glyph name="restart" size={13} />
        </button>
        <div className="acct">JM</div>
      </div>
    </header>
  );
}
