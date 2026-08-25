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

/** Shown in place of a list when the runtime the list depends on is down. */
export function EngineDown({
  runtime,
  onStart,
  starting = false,
}: {
  runtime: string;
  onStart: () => void;
  starting?: boolean;
}) {
  return (
    <div className="empty">
      <Glyph name="bolt" size={24} />
      <div>The {runtime} engine is not running, so there is nothing to list.</div>
      <button
        type="button"
        className="tool-btn is-primary"
        disabled={starting}
        onClick={onStart}
      >
        <Glyph name="play" size={12} fill="currentColor" sw={0} />
        {starting ? 'Starting…' : `Start ${runtime}`}
      </button>
    </div>
  );
}
