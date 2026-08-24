// Status bar — 32px, pinned to the bottom of the shell. Versions, the live
// running / stopped tally and the palette hint.

import { useCounts } from '@/hooks/useCounts';
import { RUNTIMES } from '@/data/seed';

export function StatusBar() {
  const counts = useCounts();

  return (
    <footer className="statusbar mono">
      <span>
        dockman 0.1 · docker {RUNTIMES.docker.version} · podman{' '}
        {RUNTIMES.podman.version}
      </span>
      <span>
        {counts.running} running · {counts.stopped} stopped
      </span>
      <span className="statusbar-trail">⌘K open command palette</span>
    </footer>
  );
}
