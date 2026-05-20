// Application state — container inventory, runtime filter and search query.
//
// Under Tauri the inventory is fetched from the Docker / Podman CLIs and
// lifecycle actions shell out for real; in the browser it falls back to the
// seed data with local mutation so the UI keeps working without a backend.

import { create } from 'zustand';
import type { Container, ContainerStatus, RuntimeFilter } from '@/types';
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

interface AppState {
  containers: Container[];
  runtimeFilter: RuntimeFilter;
  query: string;
  live: boolean;
  loading: boolean;
  error: string | null;

  setRuntimeFilter: (f: RuntimeFilter) => void;
  setQuery: (q: string) => void;

  /** Fetch the live container inventory (no-op in browser mode). */
  refresh: () => Promise<void>;

  setContainerStatus: (id: string, next: ContainerStatus) => Promise<void>;
  restartContainer: (id: string) => Promise<void>;
  toggleRunPause: (id: string) => Promise<void>;
  removeContainer: (id: string) => Promise<void>;
  startAllStopped: () => Promise<void>;
  restartAllRunning: () => Promise<void>;
  /** Start / stop every container belonging to a compose stack. */
  startStack: (stack: string) => Promise<void>;
  stopStack: (stack: string) => Promise<void>;
  /** Gentle CPU drift on running containers — seed mode aliveness only. */
  driftCpu: () => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  // Live mode starts empty and is filled by the first refresh; seed mode
  // shows the prototype inventory immediately.
  containers: isTauri() ? [] : INITIAL_CONTAINERS,
  runtimeFilter: 'all',
  query: '',
  live: isTauri(),
  loading: false,
  error: null,

  setRuntimeFilter: (runtimeFilter) => set({ runtimeFilter }),
  setQuery: (query) => set({ query }),

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
      set({ error: String(e) });
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
        if (next === 'running') await ContainerCommands.start(c.rt, id);
        else if (next === 'paused') await ContainerCommands.pause(c.rt, id);
        else await ContainerCommands.stop(c.rt, id);
      } catch (e) {
        set({ error: String(e) });
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
        set({ error: String(e) });
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
        set({ error: String(e) });
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
    if (live) {
      try {
        await ContainerCommands.remove(c.rt, id);
      } catch (e) {
        set({ error: String(e) });
      }
      await refresh();
    } else {
      set({ containers: containers.filter((x) => x.id !== id) });
    }
  },

  startAllStopped: async () => {
    const { containers, live, refresh } = get();
    if (live) {
      const stopped = containers.filter((c) => c.status === 'stopped');
      await Promise.all(
        stopped.map((c) =>
          ContainerCommands.start(c.rt, c.id).catch((e) => set({ error: String(e) })),
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
          ContainerCommands.restart(c.rt, c.id).catch((e) => set({ error: String(e) })),
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

  startStack: async (stack) => {
    const { containers, live, refresh } = get();
    const targets = containers.filter(
      (c) => c.stack === stack && c.status !== 'running',
    );
    if (live) {
      await Promise.all(
        targets.map((c) =>
          ContainerCommands.start(c.rt, c.id).catch((e) => set({ error: String(e) })),
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
          ContainerCommands.stop(c.rt, c.id).catch((e) => set({ error: String(e) })),
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

  driftCpu: () =>
    set((s) => ({
      containers: s.containers.map((c) =>
        c.status === 'running'
          ? { ...c, cpu: Math.max(0.1, c.cpu + (Math.random() - 0.5) * 0.6) }
          : c,
      ),
    })),
}));
