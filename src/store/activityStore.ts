// Activity feed — what Dockman itself did, in order. Entries are appended by
// the actions that perform them (start, pull, build, fallback, …) and kept
// across restarts in localStorage, capped so the list never grows unbounded.

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ActivityEntry, ActivityKind, RuntimeName } from '@/types';

const MAX_ENTRIES = 80;

interface ActivityState {
  entries: ActivityEntry[];
  log: (kind: ActivityKind, rt: RuntimeName, target: string, note?: string) => void;
  clear: () => void;
}

export const useActivityStore = create<ActivityState>()(
  persist(
    (set) => ({
      entries: [],
      log: (kind, rt, target, note = '') =>
        set((s) => ({
          entries: [{ at: Date.now(), rt, kind, target, note }, ...s.entries].slice(
            0,
            MAX_ENTRIES,
          ),
        })),
      clear: () => set({ entries: [] }),
    }),
    { name: 'dockman-activity' },
  ),
);

/** Append an entry from outside React (stores, command callbacks). */
export function logActivity(
  kind: ActivityKind,
  rt: RuntimeName,
  target: string,
  note = '',
): void {
  useActivityStore.getState().log(kind, rt, target, note);
}

export function formatClock(at: number): string {
  const d = new Date(at);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

export function formatRelative(at: number): string {
  const diff = Math.max(0, Date.now() - at) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}
