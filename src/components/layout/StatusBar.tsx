// Status bar — 32px, pinned to the bottom of the shell. Versions, the live
// running / stopped tally, the problems badge and the palette hint.

import { Glyph } from '@/components/ui/Icon';
import { useCounts } from '@/hooks/useCounts';
import { useRuntimes } from '@/hooks/useData';
import { useAppStore } from '@/store/appStore';
import type { RuntimeMeta } from '@/types';

const versionOf = (rt: RuntimeMeta) =>
  rt.found ? rt.version || '—' : 'not installed';

export function StatusBar() {
  const counts = useCounts();
  const { runtimes } = useRuntimes();
  const problems = useAppStore((s) => s.problems);
  const setProblemsOpen = useAppStore((s) => s.setProblemsOpen);
  const worst = problems.some((p) => p.severity === 'error')
    ? 'error'
    : problems.some((p) => p.severity === 'warning')
      ? 'warning'
      : 'info';

  return (
    <footer className="statusbar mono">
      <span>
        dockman 0.1 · docker {versionOf(runtimes.docker)} · podman{' '}
        {versionOf(runtimes.podman)}
      </span>
      <span>
        {counts.running} running · {counts.stopped} stopped
      </span>
      <button
        type="button"
        className={`statusbar-problems sev-${worst} ${problems.length ? 'has-some' : ''}`}
        onClick={() => setProblemsOpen(true)}
        title="Diagnosed problems and their fixes"
      >
        <Glyph name="warn" size={10} sw={2} />
        {problems.length === 0
          ? 'no problems'
          : `${problems.length} problem${problems.length === 1 ? '' : 's'}`}
      </button>
      <span className="statusbar-trail">⌘K open command palette</span>
    </footer>
  );
}
