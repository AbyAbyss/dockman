// ExecModal — a modal terminal for running commands inside a container.
//
// Wraps a pipe-based `{runtime} exec -i {id} {shell}` session: output streams
// in over events, input is fed line by line. Switching the shell restarts the
// session; Up/Down walk the command history.

import { useEffect, useRef, useState } from 'react';
import { Glyph } from './Icon';
import { RuntimeBadge } from './Runtime';
import { ContainerCommands, execOutputEvent } from '@/lib/commands';
import { listen, type UnlistenFn } from '@/lib/tauri';
import { useAppStore } from '@/store/appStore';
import type { Container } from '@/types';

const SHELLS = ['/bin/sh', '/bin/bash'];

export function ExecModal({
  container,
  onClose,
}: {
  container: Container;
  onClose: () => void;
}) {
  const live = useAppStore((s) => s.live);
  const [shell, setShell] = useState('/bin/sh');
  const [lines, setLines] = useState<string[]>([]);
  const [cmd, setCmd] = useState('');
  const [ready, setReady] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [histIdx, setHistIdx] = useState(-1);
  const sessionRef = useRef<string | null>(null);
  const outRef = useRef<HTMLPreElement | null>(null);

  // Start an exec session; restart it whenever the chosen shell changes.
  useEffect(() => {
    if (!live) return;
    let cancelled = false;
    let unlisten: UnlistenFn | undefined;
    setReady(false);
    setLines([`connecting · ${shell} …`]);
    ContainerCommands.execStart(container.rt, container.id, shell)
      .then(async (id) => {
        if (cancelled) {
          ContainerCommands.execStop(id).catch(() => undefined);
          return;
        }
        sessionRef.current = id;
        setReady(true);
        setLines([`● shell ready — ${shell} in ${container.name}`]);
        unlisten = await listen<string>(execOutputEvent(id), (l) =>
          setLines((prev) => [...prev.slice(-400), l]),
        );
      })
      .catch((e) => setLines([`exec failed: ${String(e)}`]));
    return () => {
      cancelled = true;
      unlisten?.();
      const id = sessionRef.current;
      sessionRef.current = null;
      if (id) ContainerCommands.execStop(id).catch(() => undefined);
    };
  }, [live, container.rt, container.id, container.name, shell]);

  // Escape closes the modal.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Keep the output scrolled to the newest line.
  useEffect(() => {
    if (outRef.current) outRef.current.scrollTop = outRef.current.scrollHeight;
  }, [lines]);

  const send = () => {
    const id = sessionRef.current;
    if (!id || !cmd.trim()) return;
    setLines((prev) => [...prev, `$ ${cmd}`]);
    setHistory((h) => [...h, cmd]);
    setHistIdx(-1);
    ContainerCommands.execInput(id, `${cmd}\n`).catch(() => undefined);
    setCmd('');
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      send();
      return;
    }
    if (e.key === 'ArrowUp' && history.length) {
      e.preventDefault();
      const idx = histIdx < 0 ? history.length - 1 : Math.max(0, histIdx - 1);
      setHistIdx(idx);
      setCmd(history[idx]);
    }
    if (e.key === 'ArrowDown' && histIdx >= 0) {
      e.preventDefault();
      const idx = histIdx + 1;
      if (idx >= history.length) {
        setHistIdx(-1);
        setCmd('');
      } else {
        setHistIdx(idx);
        setCmd(history[idx]);
      }
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel exec-modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <span className="modal-mark">
            <Glyph name="terminal" size={15} />
          </span>
          <div className="modal-head-text">
            <div className="modal-title">Shell · {container.name}</div>
            <div className="modal-sub mono">{container.image}</div>
          </div>
          <RuntimeBadge rt={container.rt} size="xs" showLabel={false} />
          <button
            className="modal-x"
            type="button"
            onClick={onClose}
            aria-label="Close"
          >
            <Glyph name="close" size={15} />
          </button>
        </header>

        {!live ? (
          <div className="modal-body">
            <div className="rcm-note">
              Exec is available when running the desktop app.
            </div>
          </div>
        ) : (
          <div className="exec-wrap">
            <div className="exec-bar">
              <span className="exec-bar-label">Shell</span>
              <div className="rcm-seg">
                {SHELLS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    className={`rcm-seg-btn mono ${shell === s ? 'is-on' : ''}`}
                    onClick={() => setShell(s)}
                  >
                    {s}
                  </button>
                ))}
              </div>
              <span className={`exec-status ${ready ? 'is-on' : ''}`}>
                {ready ? 'connected' : 'connecting…'}
              </span>
            </div>
            <pre className="exec-out" ref={outRef}>
              {lines.map((l, i) => (
                <div key={i}>{l}</div>
              ))}
            </pre>
            <div className="exec-input">
              <span className="exec-prompt mono">$</span>
              <input
                className="ti mono"
                value={cmd}
                onChange={(e) => setCmd(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder={ready ? 'type a command, press Enter' : 'waiting for shell…'}
                autoFocus
                disabled={!ready}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
