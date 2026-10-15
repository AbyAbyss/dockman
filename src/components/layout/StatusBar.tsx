// Status bar — 32px, pinned to the bottom of the shell. Versions, the live
// running / stopped tally and the palette hint.

import { useCounts } from '@/hooks/useCounts';
import { useRuntimes } from '@/hooks/useData';
import type { RuntimeMeta } from '@/types';

const versionOf = (rt: RuntimeMeta) =>
  rt.found ? rt.version || '—' : 'not installed';

export function StatusBar() {
  const counts = useCounts();
  const { runtimes } = useRuntimes();

  return (
    <footer className="statusbar mono">
      <span>
        dockman 0.1 · docker {versionOf(runtimes.docker)} · podman{' '}
        {versionOf(runtimes.podman)}
      </span>
      <span>
        {counts.running} running · {counts.stopped} stopped
      </span>
      <span className="statusbar-trail">⌘K open command palette</span>
    </footer>
  );
}
