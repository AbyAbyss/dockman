// Loading and engine-down placeholders.
//
// The handoff calls for skeleton rows at each table's own row height rather
// than a spinner, so the list does not jump when real data lands.

import { Glyph } from './Icon';

/** `rows` placeholder rows sized by the table they stand in for. */
export function SkeletonRows({
  rows = 6,
  variant = 'container',
}: {
  rows?: number;
  variant?: 'container' | 'image' | 'volume';
}) {
  return (
    <div className="skel" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className={`skel-row skel-${variant}`}>
          <span className="skel-bar" style={{ width: '22%' }} />
          <span className="skel-bar" style={{ width: '30%' }} />
          <span className="skel-bar" style={{ width: '12%' }} />
          <span className="skel-bar skel-trail" style={{ width: '16%' }} />
        </div>
      ))}
    </div>
  );
}

/** Shown in place of a list when the runtimes the list depends on are down. */
export function EngineDown({
  runtimes,
  onStart,
  starting = null,
}: {
  runtimes: string[];
  onStart: (runtime: string) => void;
  /** The runtime currently being started, if any. */
  starting?: string | null;
}) {
  const names = runtimes.join(' and ');
  return (
    <div className="empty">
      <Glyph name="bolt" size={24} />
      <div>
        The {names} {runtimes.length > 1 ? 'engines are' : 'engine is'} not running, so
        there is nothing to list.
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        {runtimes.map((rt) => (
          <button
            key={rt}
            type="button"
            className="tool-btn is-primary"
            disabled={starting !== null}
            onClick={() => onStart(rt)}
          >
            <Glyph name="play" size={12} fill="currentColor" sw={0} />
            {starting === rt ? 'Starting…' : `Start ${rt}`}
          </button>
        ))}
      </div>
    </div>
  );
}
