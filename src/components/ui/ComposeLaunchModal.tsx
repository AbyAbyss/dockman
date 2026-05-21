// ComposeLaunchModal — animated, per-service "bringing the stack up" view.
//
// Probes which runtime can run Compose, lists the file's services, then runs
// `compose up` and animates each service through pulling → creating → starting
// → running by parsing the streamed output. Raw output stays one toggle away.

import { useEffect, useRef, useState } from 'react';
import { Glyph } from './Icon';
import { ComposeCommands } from '@/lib/commands';
import { listen, type UnlistenFn } from '@/lib/tauri';
import type { RuntimeName } from '@/types';

type SvcStatus =
  | 'pending'
  | 'pulling'
  | 'creating'
  | 'starting'
  | 'running'
  | 'failed';

const RANK: Record<SvcStatus, number> = {
  pending: 0,
  pulling: 1,
  creating: 2,
  starting: 3,
  running: 4,
  failed: 5,
};

const LABEL: Record<SvcStatus, string> = {
  pending: 'Pending',
  pulling: 'Pulling',
  creating: 'Creating',
  starting: 'Starting',
  running: 'Running',
  failed: 'Failed',
};

interface Svc {
  name: string;
  status: SvcStatus;
}

/** Map one line of `compose up` output to a status keyword. */
function classify(line: string): SvcStatus | null {
  const l = line.toLowerCase();
  if (/\b(error|failed|cannot)\b/.test(l)) return 'failed';
  if (/\b(started|running|healthy)\b/.test(l)) return 'running';
  if (/\bstarting\b/.test(l)) return 'starting';
  if (/\b(created|creating|recreated|recreating)\b/.test(l)) return 'creating';
  if (/\b(pulled|pulling|downloading|extracting|waiting)\b/.test(l)) return 'pulling';
  return null;
}

/** True when a service name appears as a whole token in the line. */
function mentions(line: string, service: string): boolean {
  const esc = service.replace(/[^a-zA-Z0-9]/g, '\\$&');
  return new RegExp(`(^|[^a-zA-Z0-9])${esc}([^a-zA-Z0-9]|$)`, 'i').test(line);
}

export function ComposeLaunchModal({
  filePath,
  runtime,
  scale = [],
  title,
  onClose,
}: {
  filePath: string;
  runtime?: RuntimeName;
  scale?: string[];
  title?: string;
  onClose: () => void;
}) {
  const [phase, setPhase] = useState<'probing' | 'running' | 'done'>('probing');
  const [svcs, setSvcs] = useState<Svc[]>([]);
  const [log, setLog] = useState<string[]>([]);
  const [showLog, setShowLog] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const logRef = useRef<HTMLPreElement>(null);
  // Capture the launch inputs once so the run effect can fire exactly once.
  const launch = useRef({ filePath, runtime, scale });

  const parts = filePath.split(/[/\\]/);
  const fileName = parts[parts.length - 1] || 'compose file';
  const project = parts[parts.length - 2] || 'compose';

  // Escape closes the modal (the compose process keeps running detached).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Keep the newest output line in view.
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log]);

  // Probe → run → stream. Fires once for this launch.
  useEffect(() => {
    const { filePath: fp, runtime: rt, scale: sc } = launch.current;
    let unOut: UnlistenFn | undefined;
    let unDone: UnlistenFn | undefined;
    let cancelled = false;

    (async () => {
      // Find a runtime whose `compose` provider actually works — try the
      // preferred one first, then fall back to the others.
      const all: RuntimeName[] = ['docker', 'podman'];
      const order: RuntimeName[] = rt
        ? [rt, ...all.filter((r) => r !== rt)]
        : all;
      let chosen: RuntimeName | undefined;
      let services: string[] = [];
      let lastErr = '';
      for (const r of order) {
        try {
          services = await ComposeCommands.services(r, fp);
          chosen = r;
          break;
        } catch (e) {
          lastErr = String(e);
        }
      }
      if (cancelled) return;
      if (!chosen) {
        const noPlugin = /unknown shorthand flag|is not a .*command/i.test(lastErr);
        setError(
          noPlugin
            ? 'Docker Compose isn’t available on your runtime. Install the Compose plugin for Docker, or podman-compose for Podman, then try again.'
            : `Could not read the compose file.\n\n${lastErr}`,
        );
        setPhase('done');
        return;
      }

      setSvcs(services.map((name) => ({ name, status: 'pending' as SvcStatus })));
      setPhase('running');

      // Stream output → advance the matching service's status.
      unOut = await listen<string>('compose-output', (line) => {
        if (cancelled) return;
        setLog((prev) => [...prev.slice(-400), line]);
        const status = classify(line);
        if (!status) return;
        setSvcs((prev) =>
          prev.map((s) => {
            if (s.status === 'failed' || !mentions(line, s.name)) return s;
            return RANK[status] > RANK[s.status] ? { ...s, status } : s;
          }),
        );
      });

      // Real exit status — the authoritative final state.
      unDone = await listen<{ success: boolean; code: number }>(
        'compose-done',
        (res) => {
          if (cancelled) return;
          setSvcs((prev) =>
            prev.map((s) =>
              s.status === 'running'
                ? s
                : { ...s, status: res.success ? 'running' : 'failed' },
            ),
          );
          setOk(res.success);
          setPhase('done');
        },
      );

      try {
        await ComposeCommands.up(chosen, fp, true, sc);
      } catch (e) {
        if (!cancelled) {
          setError(`Compose failed to start.\n\n${String(e)}`);
          setPhase('done');
        }
      }
    })();

    return () => {
      cancelled = true;
      unOut?.();
      unDone?.();
    };
  }, []);

  const done = svcs.filter((s) => s.status === 'running').length;
  const total = svcs.length;
  const pct = total ? Math.round((done / total) * 100) : 0;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel clm" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <span className="modal-mark">
            <Glyph name="layers" size={15} />
          </span>
          <div className="modal-head-text">
            <div className="modal-title">{title ?? 'Composing stack'}</div>
            <div className="modal-sub mono">
              {project} · {fileName}
            </div>
          </div>
          <button className="modal-x" type="button" onClick={onClose} aria-label="Close">
            <Glyph name="close" size={15} />
          </button>
        </header>

        <div className="modal-body clm-body">
          {error ? (
            <div className="clm-error mono">{error}</div>
          ) : phase === 'probing' ? (
            <div className="clm-probing">
              <span className="clm-spin" />
              <span>Reading {fileName}…</span>
            </div>
          ) : (
            <>
              <div className="clm-progress">
                <div className="clm-progress-track">
                  <span className="clm-progress-fill" style={{ width: `${pct}%` }} />
                </div>
                <span className="clm-progress-count mono">
                  {done}/{total}
                </span>
              </div>

              <div className="clm-svcs">
                {svcs.map((s) => (
                  <div key={s.name} className={`clm-svc is-${s.status}`}>
                    <span className="clm-svc-icon">
                      {s.status === 'running' ? (
                        <Glyph name="check" size={14} />
                      ) : s.status === 'failed' ? (
                        <Glyph name="close" size={13} />
                      ) : s.status === 'pending' ? (
                        <span className="clm-dot" />
                      ) : (
                        <span className="clm-spin" />
                      )}
                    </span>
                    <span className="clm-svc-name">{s.name}</span>
                    <span className="clm-svc-status">{LABEL[s.status]}</span>
                  </div>
                ))}
              </div>

              <button
                type="button"
                className="clm-logtoggle"
                onClick={() => setShowLog((v) => !v)}
              >
                <span className={`clm-chev ${showLog ? 'is-open' : ''}`}>
                  <Glyph name="chevron" size={11} />
                </span>
                {showLog ? 'Hide output' : 'Show output'}
              </button>
              {showLog && (
                <pre className="clm-log" ref={logRef}>
                  {log.length === 0 ? (
                    <div>waiting for output…</div>
                  ) : (
                    log.map((l, i) => <div key={i}>{l}</div>)
                  )}
                </pre>
              )}
            </>
          )}
        </div>

        <footer className="modal-foot">
          {phase === 'done' ? (
            <>
              <span className={`clm-result ${error || !ok ? 'is-bad' : 'is-ok'}`}>
                {error
                  ? 'Could not start'
                  : ok
                    ? 'Stack is up'
                    : 'Finished with errors'}
              </span>
              <button className="action-btn primary" type="button" onClick={onClose}>
                Done
              </button>
            </>
          ) : (
            <button className="action-btn" type="button" onClick={onClose}>
              {phase === 'running' ? 'Run in background' : 'Cancel'}
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}
