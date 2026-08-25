// Application state — container inventory, runtime filter and search query.
//
// Under Tauri the inventory is fetched from the Docker / Podman CLIs and
// lifecycle actions shell out for real; in the browser it falls back to the
// seed data with local mutation so the UI keeps working without a backend.

import { create } from 'zustand';
import type {
  Container,
  ContainerStatus,
  RuntimeFilter,
  StatusFilter,
} from '@/types';
import { INITIAL_CONTAINERS } from '@/data/seed';
import { isTauri } from '@/lib/tauri';
import { ContainerCommands } from '@/lib/commands';

/** Recompute derived fields when a container changes status (seed mode only). */
function applyStatus(c: Container, next: ContainerStatus): Container {
  return {
    ...c,
    status: next,
    cpu: next === 'running' ? Math.max(0.5, Math.random() * 4 + 0.5) : 0,
    mem: next === 'running' ? Math.max(c.mem, 60) : next === 'paused' ? c.mem : 0,
    uptime: next === 'running' ? 'just now' : next === 'stopped' ? '—' : c.uptime,
  };
}

/** A transient failure notice. Command errors surface here rather than being
 *  swallowed — several actions run concurrently, so a single `error` string
 *  would lose all but the last one. */
export interface Toast {
  id: number;
  text: string;
  tone?: 'bad' | 'ok';
}

let toastSeq = 0;

interface AppState {
  containers: Container[];
  toasts: Toast[];
  runtimeFilter: RuntimeFilter;
  query: string;
  live: boolean;
  loading: boolean;
  error: string | null;

  /** Container-table status filter (the toolbar pills). */
  statusFilter: StatusFilter;
  /** Ids of the containers ticked in the table. */
  selection: string[];
  /** Id of the container whose detail pane is open, or null when closed. */
  focusedContainer: string | null;
  /** Desired replica count per compose project, set by the group stepper. */
  replicas: Record<string, number>;
  /** Row selection on Networks and Builds — drives their detail panels. */
  selectedNetwork: string;
  selectedBuild: string;

  setRuntimeFilter: (f: RuntimeFilter) => void;
  setQuery: (q: string) => void;
  dismissToast: (id: number) => void;
  /** Raise a failure from a page-level command call. */
  reportError: (e: unknown) => void;
  /** Raise a success notice. */
  reportOk: (text: string) => void;
  setStatusFilter: (f: StatusFilter) => void;
  setFocusedContainer: (id: string | null) => void;
  setSelectedNetwork: (name: string) => void;
  setSelectedBuild: (id: string) => void;

  toggleSelected: (id: string) => void;
  /** Tick every id, or untick them all when they are already ticked. */
  toggleSelectedMany: (ids: string[]) => void;
  clearSelection: () => void;
  setReplicas: (stack: string, n: number) => void;

  /** Fetch the live container inventory (no-op in browser mode). */
  refresh: () => Promise<void>;

  setContainerStatus: (id: string, next: ContainerStatus) => Promise<void>;
  restartContainer: (id: string) => Promise<void>;
  toggleRunPause: (id: string) => Promise<void>;
  removeContainer: (id: string) => Promise<void>;
  startAllStopped: () => Promise<void>;
  restartAllRunning: () => Promise<void>;
  /** Stop every running container — the headline bulk action. */
  stopAllRunning: () => Promise<void>;
  /** Apply a lifecycle action to the current selection, then clear it. */
  actOnSelection: (
    action: 'start' | 'stop' | 'restart' | 'remove',
  ) => Promise<void>;
  /** Start / stop / restart every container belonging to a compose stack. */
  startStack: (stack: string) => Promise<void>;
  stopStack: (stack: string) => Promise<void>;
  restartStack: (stack: string) => Promise<void>;
  /** Gentle CPU drift on running containers — seed mode aliveness only. */
  driftCpu: () => void;
}

export const useAppStore = create<AppState>((set, get) => {
  /** Record a failed command and raise it to the user. */
  const fail = (e: unknown) => {
    const text = String(e).replace(/^Error:\s*/, '');
    set((s) => ({
      error: text,
      toasts: [...s.toasts, { id: (toastSeq += 1), text }].slice(-4),
    }));
  };

  return {
  // Live mode starts empty and is filled by the first refresh; seed mode
  // shows the prototype inventory immediately.
  containers: isTauri() ? [] : INITIAL_CONTAINERS,
  runtimeFilter: 'all',
  query: '',
  live: isTauri(),
  loading: false,
  error: null,
  toasts: [],

  dismissToast: (id) =>
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  reportError: (e) => fail(e),
  reportOk: (text) =>
    set((s) => ({
      toasts: [...s.toasts, { id: (toastSeq += 1), text, tone: 'ok' as const }].slice(-4),
    })),

  statusFilter: 'all',
  selection: [],
  focusedContainer: null,
  replicas: {},
  selectedNetwork: '',
  selectedBuild: '',

  setRuntimeFilter: (runtimeFilter) => set({ runtimeFilter }),
  setQuery: (query) => set({ query }),
  setStatusFilter: (statusFilter) => set({ statusFilter }),
  setFocusedContainer: (focusedContainer) => set({ focusedContainer }),
  setSelectedNetwork: (selectedNetwork) => set({ selectedNetwork }),
  setSelectedBuild: (selectedBuild) => set({ selectedBuild }),

  toggleSelected: (id) =>
    set((s) => ({
      selection: s.selection.includes(id)
        ? s.selection.filter((x) => x !== id)
        : [...s.selection, id],
    })),

  toggleSelectedMany: (ids) =>
    set((s) => {
      const allOn = ids.length > 0 && ids.every((id) => s.selection.includes(id));
      return {
        selection: allOn
          ? s.selection.filter((id) => !ids.includes(id))
          : Array.from(new Set([...s.selection, ...ids])),
      };
    }),

  clearSelection: () => set({ selection: [] }),

  // Clamped to the same 0–9 range the group stepper offers.
  setReplicas: (stack, n) =>
    set((s) => ({
      replicas: { ...s.replicas, [stack]: Math.min(9, Math.max(0, n)) },
    })),

  refresh: async () => {
    if (!get().live) return;
    set({ loading: true });
    try {
      const containers = await ContainerCommands.list('all');
      set({ containers, error: null });
      // Best-effort cpu/mem overlay from `stats --no-stream`.
      try {
        const stats = await ContainerCommands.statsMap('all');
        if (stats.size) {
          set((s) => ({
            containers: s.containers.map((c) => {
              const st = stats.get(c.id) || stats.get(c.name);
              return st ? { ...c, cpu: st.cpu, mem: st.mem } : c;
            }),
          }));
        }
      } catch {
        /* stats are optional */
      }
    } catch (e) {
      fail(e);
    } finally {
      set({ loading: false });
    }
  },

  setContainerStatus: async (id, next) => {
    const { containers, live, refresh } = get();
    const c = containers.find((x) => x.id === id);
    if (!c) return;
    if (live) {
      try {
        if (next === 'running') {
          // A paused container resumes with `unpause`; `start` is a no-op on it.
          if (c.status === 'paused') await ContainerCommands.unpause(c.rt, id);
          else await ContainerCommands.start(c.rt, id);
        } else if (next === 'paused') await ContainerCommands.pause(c.rt, id);
        else await ContainerCommands.stop(c.rt, id);
      } catch (e) {
        fail(e);
      }
      await refresh();
    } else {
      set({
        containers: containers.map((x) => (x.id === id ? applyStatus(x, next) : x)),
      });
    }
  },

  restartContainer: async (id) => {
    const { containers, live, refresh } = get();
    const c = containers.find((x) => x.id === id);
    if (!c) return;
    if (live) {
      try {
        await ContainerCommands.restart(c.rt, id);
      } catch (e) {
        fail(e);
      }
      await refresh();
    } else {
      set({
        containers: containers.map((x) =>
          x.id === id ? applyStatus(x, 'running') : x,
        ),
      });
    }
  },

  toggleRunPause: async (id) => {
    const { containers, live, refresh } = get();
    const c = containers.find((x) => x.id === id);
    if (!c) return;
    if (live) {
      try {
        if (c.status === 'running') await ContainerCommands.pause(c.rt, id);
        else await ContainerCommands.unpause(c.rt, id);
      } catch (e) {
        fail(e);
      }
      await refresh();
    } else {
      set({
        containers: containers.map((x) =>
          x.id === id
            ? { ...x, status: x.status === 'running' ? 'paused' : 'running' }
            : x,
        ),
      });
    }
  },

  removeContainer: async (id) => {
    const { containers, live, refresh } = get();
    const c = containers.find((x) => x.id === id);
    if (!c) return;
    // Drop the id from selection / focus first — the row is about to vanish.
    set((s) => ({
      selection: s.selection.filter((x) => x !== id),
      focusedContainer: s.focusedContainer === id ? null : s.focusedContainer,
    }));
    if (live) {
      try {
        await ContainerCommands.remove(c.rt, id);
      } catch (e) {
        fail(e);
      }
      await refresh();
    } else {
      set({ containers: get().containers.filter((x) => x.id !== id) });
    }
  },

  startAllStopped: async () => {
    const { containers, live, refresh } = get();
    if (live) {
      const stopped = containers.filter((c) => c.status === 'stopped');
      await Promise.all(
        stopped.map((c) =>
          ContainerCommands.start(c.rt, c.id).catch((e) => fail(e)),
        ),
      );
      await refresh();
    } else {
      set({
        containers: containers.map((c) =>
          c.status === 'stopped' ? applyStatus(c, 'running') : c,
        ),
      });
    }
  },

  restartAllRunning: async () => {
    const { containers, live, refresh } = get();
    if (live) {
      const running = containers.filter((c) => c.status === 'running');
      await Promise.all(
        running.map((c) =>
          ContainerCommands.restart(c.rt, c.id).catch((e) => fail(e)),
        ),
      );
      await refresh();
    } else {
      set({
        containers: containers.map((c) =>
          c.status === 'running' ? { ...c, uptime: 'just now' } : c,
        ),
      });
    }
  },

  stopAllRunning: async () => {
    const { containers, live, refresh } = get();
    if (live) {
      const running = containers.filter((c) => c.status === 'running');
      await Promise.all(
        running.map((c) =>
          ContainerCommands.stop(c.rt, c.id).catch((e) => fail(e)),
        ),
      );
      await refresh();
    } else {
      set({
        containers: containers.map((c) =>
          c.status === 'running' ? applyStatus(c, 'stopped') : c,
        ),
      });
    }
  },

  actOnSelection: async (action) => {
    const { containers, selection, live, refresh } = get();
    const targets = containers.filter((c) => selection.includes(c.id));
    if (targets.length === 0) return;
    if (live) {
      await Promise.all(
        targets.map((c) => {
          const call =
            action === 'start'
              ? c.status === 'paused'
                ? ContainerCommands.unpause(c.rt, c.id)
                : ContainerCommands.start(c.rt, c.id)
              : action === 'stop'
                ? ContainerCommands.stop(c.rt, c.id)
                : action === 'restart'
                  ? ContainerCommands.restart(c.rt, c.id)
                  : ContainerCommands.remove(c.rt, c.id);
          return call.catch((e) => fail(e));
        }),
      );
      set({ selection: [] });
      await refresh();
    } else {
      const ids = targets.map((c) => c.id);
      set({
        containers:
          action === 'remove'
            ? containers.filter((c) => !ids.includes(c.id))
            : containers.map((c) =>
                ids.includes(c.id)
                  ? action === 'stop'
                    ? applyStatus(c, 'stopped')
                    : applyStatus(c, 'running')
                  : c,
              ),
        selection: [],
      });
    }
    // A removed container must not keep the detail pane open.
    set((s) => ({
      focusedContainer: s.containers.some((c) => c.id === s.focusedContainer)
        ? s.focusedContainer
        : null,
    }));
  },

  startStack: async (stack) => {
    const { containers, live, refresh } = get();
    const targets = containers.filter(
      (c) => c.stack === stack && c.status !== 'running',
    );
    if (live) {
      await Promise.all(
        targets.map((c) =>
          ContainerCommands.start(c.rt, c.id).catch((e) => fail(e)),
        ),
      );
      await refresh();
    } else {
      set({
        containers: containers.map((c) =>
          c.stack === stack && c.status !== 'running'
            ? applyStatus(c, 'running')
            : c,
        ),
      });
    }
  },

  stopStack: async (stack) => {
    const { containers, live, refresh } = get();
    const targets = containers.filter(
      (c) => c.stack === stack && c.status === 'running',
    );
    if (live) {
      await Promise.all(
        targets.map((c) =>
          ContainerCommands.stop(c.rt, c.id).catch((e) => fail(e)),
        ),
      );
      await refresh();
    } else {
      set({
        containers: containers.map((c) =>
          c.stack === stack && c.status === 'running'
            ? applyStatus(c, 'stopped')
            : c,
        ),
      });
    }
  },

  restartStack: async (stack) => {
    const { containers, live, refresh } = get();
    const targets = containers.filter((c) => c.stack === stack);
    if (live) {
      await Promise.all(
        targets.map((c) =>
          ContainerCommands.restart(c.rt, c.id).catch((e) =>
            fail(e),
          ),
        ),
      );
      await refresh();
    } else {
      set({
        containers: containers.map((c) =>
          c.stack === stack ? applyStatus(c, 'running') : c,
        ),
      });
    }
  },

  driftCpu: () =>
    set((s) => ({
      containers: s.containers.map((c) =>
        c.status === 'running'
          ? { ...c, cpu: Math.max(0.1, c.cpu + (Math.random() - 0.5) * 0.6) }
          : c,
      ),
    })),
  };
});
