// Problems panel — every diagnosed problem in one place: what happened, why,
// and the fix. Opened from the status bar badge. Rows elsewhere (containers,
// engines) link into the same list.

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Glyph } from './Icon';
import { ConfirmDialog } from './ConfirmDialog';
import { RuntimeCommands } from '@/lib/commands';
import { useAppStore } from '@/store/appStore';
import type { ProblemEntry, ProblemFix } from '@/types';

const SEVERITY_LABEL = { info: 'note', warning: 'warning', error: 'failed' } as const;

function ProblemCard({
  p,
  onFix,
}: {
  p: ProblemEntry;
  onFix: (fix: ProblemFix, p: ProblemEntry) => void;
}) {
  const dismiss = useAppStore((s) => s.dismissProblem);
  const [details, setDetails] = useState(false);
  const scope = p.container
    ? `container ${p.container.slice(0, 12)}`
    : p.image
      ? p.image
      : `${p.engine} engine`;

  return (
    <div className={`prob sev-${p.severity}`}>
      <div className="prob-head">
        <span className="prob-sev mono">{SEVERITY_LABEL[p.severity]}</span>
        <span className="prob-scope mono">
          <span className={`ctr-rt rt-${p.engine}`} /> {scope}
        </span>
        <button
          type="button"
          className="toast-x"
          aria-label="Dismiss"
          onClick={() => dismiss(p.key)}
        >
          <Glyph name="close" size={11} sw={2} />
        </button>
      </div>
      <div className="prob-msg">{p.message}</div>
      <div className="prob-cause">{p.cause}</div>
      <div className="prob-fixes">
        {p.fixes.map((f) => (
          <button
            key={f.label}
            type="button"
            className={`action-btn ${f.action ? 'primary' : ''}`}
            title={f.command ?? undefined}
            onClick={() => onFix(f, p)}
          >
            {f.label}
          </button>
        ))}
        {p.logTail && (
          <button
            type="button"
            className="text-btn"
            onClick={() => setDetails((v) => !v)}
          >
            {details ? 'hide details' : 'details'}
          </button>
        )}
      </div>
      {p.fixes.some((f) => f.command) && (
        <div className="prob-cmds">
          {p.fixes
            .filter((f) => f.command)
            .map((f) => (
              <code key={f.label} className="prob-cmd mono">
                {f.command}
              </code>
            ))}
        </div>
      )}
      {details && <pre className="prob-log mono">{p.logTail}</pre>}
    </div>
  );
}

export function ProblemsPanel() {
  const open = useAppStore((s) => s.problemsOpen);
  const setOpen = useAppStore((s) => s.setProblemsOpen);
  const problems = useAppStore((s) => s.problems);
  const reportOk = useAppStore((s) => s.reportOk);
  const reportError = useAppStore((s) => s.reportError);
  const navigate = useNavigate();
  const [confirmRootful, setConfirmRootful] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  const switchRootful = () => {
    setBusy(true);
    RuntimeCommands.setRootful(true)
      .then(() => reportOk('Podman machine restarted in rootful mode'))
      .catch(reportError)
      .finally(() => setBusy(false));
  };

  const onFix = (fix: ProblemFix, p: ProblemEntry) => {
    switch (fix.action) {
      case 'set_rootful':
        setConfirmRootful(true);
        return;
      case 'open_engines':
        setOpen(false);
        navigate('/binaries');
        return;
      case 'retry_platform':
        // The run modal / pull retry this automatically; here the command is
        // the fix, so hand it to the clipboard.
        break;
      default:
        break;
    }
    if (fix.command) {
      navigator.clipboard?.writeText(fix.command).then(
        () => reportOk(`Copied: ${fix.command}`),
        () => undefined,
      );
    } else if (p.container) {
      setOpen(false);
      navigate('/containers');
    }
  };

  const ordered = [...problems].sort((a, b) => {
    const rank = { error: 0, warning: 1, info: 2 };
    return rank[a.severity] - rank[b.severity] || b.at - a.at;
  });

  return (
    <div className="prob-overlay" onClick={() => setOpen(false)}>
      <aside className="prob-panel" onClick={(e) => e.stopPropagation()}>
        <header className="prob-panel-head">
          <span className="prob-panel-title">
            <Glyph name="warn" size={14} /> Problems
          </span>
          <span className="toolbar-note mono">
            {problems.length === 0 ? 'nothing to fix' : `${problems.length} diagnosed`}
          </span>
          <button
            type="button"
            className="modal-x"
            aria-label="Close"
            onClick={() => setOpen(false)}
          >
            <Glyph name="close" size={15} />
          </button>
        </header>
        <div className="prob-list">
          {ordered.length === 0 && (
            <div className="det-empty mono">
              Failures the app recognises show up here with their cause and a fix.
            </div>
          )}
          {ordered.map((p) => (
            <ProblemCard key={p.key} p={p} onFix={onFix} />
          ))}
        </div>
      </aside>

      {confirmRootful && (
        <ConfirmDialog
          title="Switch podman to rootful?"
          body="The podman machine will stop, switch to rootful mode and start again. Rootful and rootless podman keep separate stores: containers, images and volumes created in rootless mode stay on disk but disappear from view until you switch back."
          confirmLabel={busy ? 'Switching…' : 'Switch and restart'}
          tone="default"
          onConfirm={switchRootful}
          onClose={() => setConfirmRootful(false)}
        />
      )}
    </div>
  );
}
