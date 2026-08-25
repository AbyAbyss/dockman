// A real terminal, backed by a PTY on the Rust side.
//
// xterm owns the emulation: keystrokes go straight to the PTY as raw bytes
// (Enter is `\r`, Ctrl-C is `\x03`), and whatever comes back is written
// verbatim, so prompts, colours, tab-completion and full-screen programs like
// `top` all behave the way they do in a normal terminal.

import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { ContainerCommands, execOutputEvent } from '@/lib/commands';
import { listen, type UnlistenFn } from '@/lib/tauri';
import { useThemeStore } from '@/store/themeStore';
import type { Container } from '@/types';

/** Terminal colours per theme, read from the same tokens the app uses. */
function paletteFor(root: HTMLElement) {
  const v = (name: string) =>
    getComputedStyle(root).getPropertyValue(name).trim() || undefined;
  return {
    background: v('--bg'),
    foreground: v('--text'),
    cursor: v('--accent'),
    cursorAccent: v('--bg'),
    selectionBackground: v('--accent-soft'),
  };
}

export function ShellTerminal({
  container,
  live,
}: {
  container: Container;
  live: boolean;
}) {
  const mode = useThemeStore((s) => s.mode);
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const sessionRef = useRef<string | null>(null);
  const [status, setStatus] = useState<'connecting' | 'attached' | 'closed' | 'error'>(
    'connecting',
  );
  const [message, setMessage] = useState('');

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const term = new Terminal({
      fontFamily: getComputedStyle(host).getPropertyValue('--mono') || 'monospace',
      fontSize: 12,
      lineHeight: 1.3,
      cursorBlink: true,
      convertEol: false,
      theme: paletteFor(document.documentElement.querySelector('.dockman-root') as HTMLElement ?? host),
      scrollback: 5000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    termRef.current = term;
    fitRef.current = fit;

    // fit() measures the DOM, so it throws if the host has not been laid out
    // yet — which is exactly the case on the frame the pane mounts, and again
    // whenever the tab is hidden (zero height).
    const safeFit = () => {
      if (!host.isConnected || host.clientWidth === 0 || host.clientHeight === 0) return;
      try {
        fit.fit();
      } catch {
        /* terminal not measurable yet; the ResizeObserver will retry */
      }
    };
    let ready = false;
    requestAnimationFrame(() => {
      ready = true;
      safeFit();
      flush();
    });

    // xterm's renderer is not measurable until after the first paint, and
    // writing before then throws inside the renderer. Queue instead.
    let pending: string[] = [];
    const write = (s: string) => {
      if (ready) {
        try {
          term.write(s);
          return;
        } catch {
          /* fall through to the queue */
        }
      }
      pending.push(s);
    };
    const flush = () => {
      const queued = pending;
      pending = [];
      for (const s of queued) {
        try {
          term.write(s);
        } catch {
          /* terminal is going away */
        }
      }
    };

    let unlistenOut: UnlistenFn | undefined;
    let unlistenExit: UnlistenFn | undefined;
    let cancelled = false;

    if (!live) {
      // Browser mode has no backend to attach to; say so rather than pretending.
      write('\x1b[2mThis shell needs the desktop app — no runtime here.\x1b[0m\r\n');
      setStatus('closed');
    } else {
      ContainerCommands.execStart(
        container.rt,
        container.id,
        '/bin/sh',
        term.cols,
        term.rows,
      )
        .then(async (id) => {
          if (cancelled) {
            ContainerCommands.execStop(id).catch(() => undefined);
            return;
          }
          sessionRef.current = id;
          setStatus('attached');
          unlistenOut = await listen<string>(execOutputEvent(id), (chunk) =>
            write(chunk),
          );
          unlistenExit = await listen<unknown>(`${execOutputEvent(id)}-exit`, () => {
            setStatus('closed');
            write('\r\n\x1b[2m— session ended —\x1b[0m\r\n');
          });
          term.focus();
        })
        .catch((e) => {
          setStatus('error');
          setMessage(String(e));
          write(`\x1b[31m${String(e)}\x1b[0m\r\n`);
        });

      // Every keystroke goes to the PTY untouched.
      term.onData((data) => {
        const id = sessionRef.current;
        if (id) ContainerCommands.execInput(id, data).catch(() => undefined);
      });
    }

    const onResize = () => {
      safeFit();
      const id = sessionRef.current;
      if (id) ContainerCommands.execResize(id, term.cols, term.rows).catch(() => undefined);
    };
    const ro = new ResizeObserver(onResize);
    ro.observe(host);

    return () => {
      cancelled = true;
      ro.disconnect();
      unlistenOut?.();
      unlistenExit?.();
      const id = sessionRef.current;
      sessionRef.current = null;
      if (id) ContainerCommands.execStop(id).catch(() => undefined);
      termRef.current = null;
      // xterm's open() schedules its own deferred work (viewport sync). Under
      // StrictMode the effect unmounts immediately, and disposing synchronously
      // leaves that callback to run against a torn-down renderer and throw.
      // Queueing our dispose after theirs lets it complete against a live one.
      setTimeout(() => term.dispose(), 0);
    };
    // A new container means a new session; the theme is applied separately.
  }, [live, container.rt, container.id]);

  // Recolour in place when the theme mode changes, without restarting the shell.
  useEffect(() => {
    const term = termRef.current;
    const root = document.querySelector('.dockman-root') as HTMLElement | null;
    if (!term || !root) return;
    try {
      term.options.theme = paletteFor(root);
    } catch {
      /* renderer not up yet; the next mount picks the theme up */
    }
  }, [mode]);

  return (
    <>
      <div className="term-head mono">
        <span className={`term-dot is-${status}`} />
        <span>
          {status === 'attached'
            ? `attached · sh · ${container.name} · ${container.rt}`
            : status === 'connecting'
              ? 'connecting…'
              : status === 'error'
                ? message || 'could not attach'
                : 'not attached'}
        </span>
      </div>
      <div className="term-host" ref={hostRef} />
    </>
  );
}
