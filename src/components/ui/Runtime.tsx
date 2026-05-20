import { RUNTIMES } from '@/data/seed';
import type { RuntimeFilter, RuntimeName } from '@/types';

interface RuntimeBadgeProps {
  rt: RuntimeName;
  size?: 'sm' | 'xs';
  showLabel?: boolean;
}

/** Small colored chip identifying a Docker / Podman entity. */
export function RuntimeBadge({ rt, size = 'sm', showLabel = true }: RuntimeBadgeProps) {
  const meta = RUNTIMES[rt];
  if (!meta) return null;
  return (
    <span className={`rt-badge rt-${rt} sz-${size}`}>
      <span className="rt-dot" style={{ background: meta.accent }} />
      {showLabel && <span className="rt-label">{meta.short}</span>}
    </span>
  );
}

interface RuntimeSwitcherProps {
  active: RuntimeFilter;
  setActive: (f: RuntimeFilter) => void;
}

/** Segmented control in the top bar — Both / Docker / Podman. */
export function RuntimeSwitcher({ active, setActive }: RuntimeSwitcherProps) {
  const opts: { k: RuntimeFilter; l: string }[] = [
    { k: 'all', l: 'Both' },
    { k: 'docker', l: 'Docker' },
    { k: 'podman', l: 'Podman' },
  ];
  return (
    <div className="rt-switcher">
      {opts.map((o) => (
        <button
          key={o.k}
          type="button"
          className={`rt-sw-btn ${active === o.k ? 'is-on' : ''} rt-sw-${o.k}`}
          onClick={() => setActive(o.k)}
        >
          {o.k !== 'all' && (
            <span className="rt-dot" style={{ background: RUNTIMES[o.k].accent }} />
          )}
          {o.l}
        </button>
      ))}
    </div>
  );
}
