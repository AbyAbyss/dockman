// LaunchCard — animated "scaffolding a container" loader.
//
// Shown while the hello-world image is being pulled and run. `run_container`
// shells out to a single blocking CLI call with no progress events, so there
// is no real percentage to display: the stage labels cycle cosmetically and
// the indeterminate bar + shimmer skeleton communicate "working" honestly
// without faking a number.

import { useEffect, useState } from 'react';
import type { RuntimeName } from '@/types';

// The container glyph, reused as a wireframe that draws itself in on a loop.
const CONTAINER_PATH =
  'M3 7l9-4 9 4M3 7v10l9 4 9-4V7M3 7l9 4M21 7l-9 4M12 11v10';

const STAGES = ['Pulling image layers', 'Creating container', 'Starting up'];

export function LaunchCard({
  rt,
  image = 'hello-world',
  note,
}: {
  rt: RuntimeName;
  image?: string;
  /** Optional second line, e.g. the resource limits being applied. */
  note?: string;
}) {
  const [stage, setStage] = useState(0);

  useEffect(() => {
    // Advance through plausible phases and hold on the last one.
    const t = window.setInterval(
      () => setStage((s) => Math.min(s + 1, STAGES.length - 1)),
      1700,
    );
    return () => window.clearInterval(t);
  }, []);

  return (
    <div className="launch-card" data-rt={rt}>
      <div className="launch-viz">
        <span className="launch-ring" />
        <span className="launch-ring launch-ring-2" />
        <svg className="launch-cube" viewBox="0 0 24 24" aria-hidden="true">
          <path className="launch-cube-ghost" d={CONTAINER_PATH} />
          <path className="launch-cube-draw" d={CONTAINER_PATH} pathLength={100} />
        </svg>
      </div>

      <div className="launch-head">
        <div className="launch-title">Scaffolding container</div>
        <div className="launch-sub mono">{image} · {rt}</div>
        {note && <div className="launch-note mono">{note}</div>}
      </div>

      <div className="launch-track" role="progressbar" aria-label="Launching container">
        <span className="launch-track-fill" />
      </div>

      <div className="launch-status mono">
        <span className="launch-dots">
          <i />
          <i />
          <i />
        </span>
        {STAGES[stage]}
      </div>

      <div className="launch-skel" aria-hidden="true">
        <span className="skel-pic" />
        <span className="skel-lines">
          <span className="skel-bar" />
          <span className="skel-bar skel-bar-sm" />
        </span>
        <span className="skel-pill" />
      </div>
    </div>
  );
}
