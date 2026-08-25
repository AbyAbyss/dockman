// ⌘K command palette. Opened from the command-bar search field or the
// keyboard; rows either navigate or run an action and close.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Glyph } from '@/components/ui/Icon';
import { useAppStore } from '@/store/appStore';
import { MODES, useThemeStore } from '@/store/themeStore';

interface Command {
  key: string;
  label: string;
  sub: string;
  run: () => void;
}

export function CommandPalette({
  onClose,
  onStopAllRunning,
}: {
  onClose: () => void;
  /** Routed through the page so the confirm dialog stays in one place. */
  onStopAllRunning: () => void;
}) {
  const navigate = useNavigate();
  const containers = useAppStore((s) => s.containers);
  const restartAllRunning = useAppStore((s) => s.restartAllRunning);
  const mode = useThemeStore((s) => s.mode);
  const setMode = useThemeStore((s) => s.setMode);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const running = containers.filter((c) => c.status === 'running').length;

  const commands = useMemo<Command[]>(() => {
    const go = (path: string) => () => {
      navigate(path);
      onClose();
    };
    return [
      { key: '⌘1', label: 'Go to Overview', sub: 'navigate', run: go('/') },
      { key: '⌘2', label: 'Go to Containers', sub: 'navigate', run: go('/containers') },
      {
        key: '⇧S',
        label: 'Stop all running containers',
        sub: `action · ${running}`,
        run: () => {
          onClose();
          onStopAllRunning();
        },
      },
      {
        key: '⇧R',
        label: 'Restart everything',
        sub: 'action',
        run: () => {
          restartAllRunning();
          onClose();
        },
      },
      {
        key: '⇧T',
        label: `Switch to ${MODES[mode === 'serious' ? 'playful' : 'serious'].label} theme`,
        sub: 'appearance',
        run: () => {
          setMode(mode === 'serious' ? 'playful' : 'serious');
          onClose();
        },
      },
      { key: '⌘P', label: 'Pull image…', sub: 'registry', run: go('/images') },
      { key: '⌘B', label: 'New build…', sub: 'builds', run: go('/builds') },
      { key: '⌘,', label: 'Settings', sub: 'navigate', run: go('/settings') },
    ];
  }, [navigate, onClose, onStopAllRunning, restartAllRunning, running, mode, setMode]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter(
      (c) =>
        c.label.toLowerCase().includes(q) || c.sub.toLowerCase().includes(q),
    );
  }, [commands, query]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Keep the cursor inside the filtered list as the query narrows it.
  useEffect(() => {
    setCursor((i) => Math.min(i, Math.max(0, matches.length - 1)));
  }, [matches.length]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor((i) => (matches.length ? (i + 1) % matches.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((i) =>
        matches.length ? (i - 1 + matches.length) % matches.length : 0,
      );
    } else if (e.key === 'Enter') {
      e.preventDefault();
      matches[cursor]?.run();
    }
  };

  return (
    <div className="modal-scrim is-palette" onClick={onClose}>
      <div
        className="palette"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className="palette-head">
          <span className="palette-search-icon">
            <Glyph name="search" size={15} sw={1.7} />
          </span>
          <input
            ref={inputRef}
            className="palette-input"
            placeholder="Type a command or search…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <kbd className="palette-kbd mono">esc</kbd>
        </div>
        <div className="palette-list">
          {matches.length === 0 && (
            <div className="palette-empty mono">no matching command</div>
          )}
          {matches.map((c, i) => (
            <button
              key={c.label}
              type="button"
              className={`palette-row ${i === cursor ? 'is-cursor' : ''}`}
              onMouseEnter={() => setCursor(i)}
              onClick={c.run}
            >
              <span className="palette-row-l">{c.label}</span>
              <span className="palette-row-s mono">{c.sub}</span>
              <kbd className="palette-row-k mono">{c.key}</kbd>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
