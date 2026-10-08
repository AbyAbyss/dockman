// Application state — container inventory, resource samples, runtime filter
// and search query. The inventory is fetched from the Docker / Podman CLIs
// and every lifecycle action shells out for real.

import { create } from 'zustand';
import type { Container, ContainerStatus, RuntimeFilter, RuntimeName } from '@/types';
import { ContainerCommands } from '@/lib/commands';
import { logActivity } from './activityStore';

/** How many `refresh` samples the sparklines keep (5 s apart → 2 minutes). */
const HISTORY = 24;

export interface ResourceSample {
  /** Sum of container CPU percentages (100 = one full core). */
  cpu: number;
  /** Sum of container memory in MB. */
  mem: number;
  /** Aggregate network rates in bytes per second, from NetIO deltas. */
  netIn: number;
  netOut: number;
  at: number;
}

interface AppState {
  containers: Container[];
  /** Latest aggregate sample plus the ones before it, oldest first. */
  history: ResourceSample[];
  runtimeFilter: RuntimeFilter;
  query: string;
  live: boolean;
  loading: boolean;
  error: string | null;

  setRuntimeFilter: (f: RuntimeFilter) => void;
  setQuery: (q: string) => void;
  clearError: () => void;

  /** Fetch the container inventory and a stats snapshot. */
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
}

/** Previous cumulative NetIO per container, for rate calculation. */
let lastNet: { at: number; byId: Map<string, { netIn: number; netOut: number }> } | null =
  null;

export const useAppStore = create<AppState>((set, get) => ({
  containers: [],
  history: [],
  runtimeFilter: 'all',
  query: '',
  live: true,
  loading: false,
  error: null,

  setRuntimeFilter: (runtimeFilter) => set({ runtimeFilter }),
  setQuery: (query) => set({ query }),
  clearError: () => set({ error: null }),

  refresh: async () => {
    set({ loading: true });
    try {
      const containers = await ContainerCommands.list('all');
      set({ containers, error: null });
      // Best-effort cpu/mem overlay from `stats --no-stream`.
      try {
        const stats = await ContainerCommands.stats('all');
        const byId = new Map<string, { cpu: number; mem: number }>();
        const netNow = new Map<string, { netIn: number; netOut: number }>();
        let cpu = 0;
        let mem = 0;
        for (const s of stats) {
          const v = { cpu: s.cpu, mem: s.mem };
          if (s.id) byId.set(s.id, v);
          if (s.name) byId.set(s.name, v);
          netNow.set(s.id || s.name, { netIn: s.netIn, netOut: s.netOut });
          cpu += s.cpu;
          mem += s.mem;
        }
        const at = Date.now();
        let netIn = 0;
        let netOut = 0;
        if (lastNet) {
          const dt = (at - lastNet.at) / 1000;
          if (dt > 0) {
            for (const [id, now] of netNow) {
              const prev = lastNet.byId.get(id);
              if (!prev) continue;
              netIn += Math.max(0, now.netIn - prev.netIn) / dt;
              netOut += Math.max(0, now.netOut - prev.netOut) / dt;
            }
          }
        }
        lastNet = { at, byId: netNow };
        set((s) => ({
          containers: s.containers.map((c) => {
            const st = byId.get(c.id) || byId.get(c.name);
            return st ? { ...c, cpu: st.cpu, mem: st.mem } : c;
          }),
          history: [...s.history, { cpu, mem, netIn, netOut, at }].slice(-HISTORY),
        }));
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
    const { containers, refresh } = get();
    const c = containers.find((x) => x.id === id);
    if (!c) return;
    try {
      if (next === 'running') await ContainerCommands.start(c.rt, id);
      else if (next === 'paused') await ContainerCommands.pause(c.rt, id);
      else await ContainerCommands.stop(c.rt, id);
      logActivity(
        next === 'running' ? 'start' : next === 'paused' ? 'pause' : 'stop',
        c.rt,
        c.name,
        `image ${c.image}`,
      );
    } catch (e) {
      set({ error: String(e) });
      logActivity('error', c.rt, c.name, String(e));
    }
    await refresh();
  },

  restartContainer: async (id) => {
    const { containers, refresh } = get();
    const c = containers.find((x) => x.id === id);
    if (!c) return;
    try {
      await ContainerCommands.restart(c.rt, id);
      logActivity('restart', c.rt, c.name, `image ${c.image}`);
    } catch (e) {
      set({ error: String(e) });
      logActivity('error', c.rt, c.name, String(e));
    }
    await refresh();
  },

  toggleRunPause: async (id) => {
    const { containers, setContainerStatus } = get();
    const c = containers.find((x) => x.id === id);
    if (!c) return;
    if (c.status === 'running') await setContainerStatus(id, 'paused');
    else if (c.status === 'paused') {
      try {
        await ContainerCommands.unpause(c.rt, id);
        logActivity('start', c.rt, c.name, 'unpaused');
      } catch (e) {
        set({ error: String(e) });
      }
      await get().refresh();
    } else await setContainerStatus(id, 'running');
  },

  removeContainer: async (id) => {
    const { containers, refresh } = get();
    const c = containers.find((x) => x.id === id);
    if (!c) return;
    try {
      await ContainerCommands.remove(c.rt, id);
      logActivity('remove', c.rt, c.name, `image ${c.image}`);
    } catch (e) {
      set({ error: String(e) });
      logActivity('error', c.rt, c.name, String(e));
    }
    await refresh();
  },

  startAllStopped: async () => {
    const { containers, refresh } = get();
    const targets = containers.filter((c) => c.status !== 'running');
    await Promise.all(
      targets.map(async (c) => {
        try {
          if (c.status === 'paused') await ContainerCommands.unpause(c.rt, c.id);
          else await ContainerCommands.start(c.rt, c.id);
          logActivity('start', c.rt, c.name, 'start all');
        } catch (e) {
          set({ error: String(e) });
        }
      }),
    );
    await refresh();
  },

  restartAllRunning: async () => {
    const { containers, refresh } = get();
    const targets = containers.filter((c) => c.status === 'running');
    await Promise.all(
      targets.map(async (c) => {
        try {
          await ContainerCommands.restart(c.rt, c.id);
          logActivity('restart', c.rt, c.name, 'restart all');
        } catch (e) {
          set({ error: String(e) });
        }
      }),
    );
    await refresh();
  },

  startStack: async (stack) => {
    const { containers, refresh } = get();
    const targets = containers.filter((c) => c.stack === stack && c.status !== 'running');
    await Promise.all(
      targets.map(async (c) => {
        try {
          if (c.status === 'paused') await ContainerCommands.unpause(c.rt, c.id);
          else await ContainerCommands.start(c.rt, c.id);
        } catch (e) {
          set({ error: String(e) });
        }
      }),
    );
    if (targets[0]) logActivity('start', targets[0].rt, stack, `${targets.length} containers`);
    await refresh();
  },

  stopStack: async (stack) => {
    const { containers, refresh } = get();
    const targets = containers.filter((c) => c.stack === stack && c.status !== 'stopped');
    await Promise.all(
      targets.map(async (c) => {
        try {
          await ContainerCommands.stop(c.rt, c.id);
        } catch (e) {
          set({ error: String(e) });
        }
      }),
    );
    if (targets[0]) logActivity('stop', targets[0].rt, stack, `${targets.length} containers`);
    await refresh();
  },
}));

export type { RuntimeName };
