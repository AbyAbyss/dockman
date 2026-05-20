// Typed command bridge. Every backend call the UI makes goes through here so
// the invoke() surface lives in exactly one place. List calls fan out across
// the active runtime(s) and normalise the result into app types.

import { invoke } from './tauri';
import {
  parseContainer,
  parseImage,
  parseNetwork,
  parseStat,
  parseVolume,
  type Raw,
} from './parsers';
import type {
  BuildRecord,
  Container,
  ImageItem,
  Network,
  RuntimeFilter,
  RuntimeName,
  Volume,
} from '@/types';

export interface RuntimeInfo {
  runtime: RuntimeName;
  found: boolean;
  path: string;
  version: string;
  isRunning: boolean;
  arch: string;
  composeAvailable: boolean;
}

export interface SetupStatus {
  runtime: RuntimeName;
  cliInstalled: boolean;
  cliVersion: string;
  engineRunning: boolean;
  helpersReady: boolean;
  machineExists: boolean;
  engineApp: string;
}

export interface BinaryRelease {
  version: string;
  url: string;
  platform: string;
  arch: string;
}

export interface RunContainerConfig {
  image: string;
  name?: string;
  ports: string[];
  env: string[];
  volumes: string[];
  /** Optional command / args override, appended after the image. */
  command: string[];
  detach: boolean;
}

export interface NewBuildConfig {
  runtime: RuntimeName;
  tag: string;
  /** Optional explicit Dockerfile path; defaults to `{contextPath}/Dockerfile`. */
  dockerfile?: string;
  contextPath: string;
  buildArgs: string[];
  platform?: string;
  useCache: boolean;
  pushOnSuccess: boolean;
}

function runtimesFor(filter: RuntimeFilter): RuntimeName[] {
  return filter === 'all' ? ['docker', 'podman'] : [filter];
}

/** Run a per-runtime fetch across the active filter, tolerating a missing runtime. */
async function fanOut<T>(
  filter: RuntimeFilter,
  fn: (rt: RuntimeName) => Promise<T[]>,
): Promise<T[]> {
  const lists = await Promise.all(
    runtimesFor(filter).map(async (rt) => {
      try {
        return await fn(rt);
      } catch {
        return [] as T[];
      }
    }),
  );
  return lists.flat();
}

/** Drop duplicates — when Docker and Podman share an engine (e.g. OrbStack)
 *  the same object is reported by both CLIs. */
function dedupeBy<T>(items: T[], key: (x: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const k = key(item);
    if (k && seen.has(k)) continue;
    if (k) seen.add(k);
    out.push(item);
  }
  return out;
}

// ─── Event names ─────────────────────────────────────────────────────────────

export const containerLogsEvent = (id: string) => `container-logs-${id}`;
export const execOutputEvent = (id: string) => `exec-output-${id}`;
export const buildOutputEvent = (id: string) => `build-output-${id}`;
export const BUILDS_CHANGED = 'builds-changed';
export const DOWNLOAD_PROGRESS = 'download-progress';

// ─── Runtime ─────────────────────────────────────────────────────────────────

export const RuntimeCommands = {
  detectAll: () => invoke<RuntimeInfo[]>('detect_all_runtimes'),
  setMode: (mode: string) => invoke<void>('set_runtime_mode', { mode }),
  setPath: (runtime: RuntimeName, path: string) =>
    invoke<void>('set_runtime_path', { runtime, path }),
  startDaemon: (runtime: RuntimeName) =>
    invoke<void>('start_runtime_daemon', { runtime }),
  stopDaemon: (runtime: RuntimeName) =>
    invoke<void>('stop_runtime_daemon', { runtime }),
  setupStatus: (runtime: RuntimeName) =>
    invoke<SetupStatus>('get_setup_status', { runtime }),
  removeBinary: (runtime: RuntimeName) =>
    invoke<void>('remove_binary', { runtime }),
};

// ─── Containers ──────────────────────────────────────────────────────────────

export const ContainerCommands = {
  list: async (filter: RuntimeFilter): Promise<Container[]> => {
    const all = await fanOut(filter, async (rt) => {
      const raw = await invoke<Raw[]>('list_containers', { runtime: rt, all: true });
      return raw.map((r) => parseContainer(rt, r));
    });
    return dedupeBy(all, (c) => c.id);
  },
  start: (rt: RuntimeName, id: string) =>
    invoke<void>('start_container', { runtime: rt, id }),
  stop: (rt: RuntimeName, id: string) =>
    invoke<void>('stop_container', { runtime: rt, id }),
  restart: (rt: RuntimeName, id: string) =>
    invoke<void>('restart_container', { runtime: rt, id }),
  pause: (rt: RuntimeName, id: string) =>
    invoke<void>('pause_container', { runtime: rt, id }),
  unpause: (rt: RuntimeName, id: string) =>
    invoke<void>('unpause_container', { runtime: rt, id }),
  remove: (rt: RuntimeName, id: string, force = true) =>
    invoke<void>('remove_container', { runtime: rt, id, force }),
  run: (rt: RuntimeName, cfg: RunContainerConfig) =>
    invoke<string>('run_container', { runtime: rt, ...cfg }),
  inspect: (rt: RuntimeName, id: string) =>
    invoke<unknown>('inspect_container', { runtime: rt, id }),
  /** Snapshot of cpu/mem for running containers, keyed by id and by name. */
  statsMap: async (
    filter: RuntimeFilter,
  ): Promise<Map<string, { cpu: number; mem: number }>> => {
    const stats = await fanOut(filter, async (rt) => {
      const raw = await invoke<Raw[]>('list_container_stats', { runtime: rt });
      return raw.map(parseStat);
    });
    const map = new Map<string, { cpu: number; mem: number }>();
    for (const s of stats) {
      const v = { cpu: s.cpu, mem: s.mem };
      if (s.id) map.set(s.id, v);
      if (s.name) map.set(s.name, v);
    }
    return map;
  },
  startLogs: (rt: RuntimeName, id: string, tail = 200) =>
    invoke<void>('get_container_logs', { runtime: rt, id, tail, timestamps: false }),
  stopLogs: (id: string) => invoke<void>('stop_container_logs', { id }),
  execStart: (rt: RuntimeName, id: string, shell: string) =>
    invoke<string>('exec_start', { runtime: rt, id, shell }),
  execInput: (sessionId: string, input: string) =>
    invoke<void>('exec_input', { sessionId, input }),
  execStop: (sessionId: string) => invoke<void>('exec_stop', { sessionId }),
};

// ─── Images ──────────────────────────────────────────────────────────────────

export const ImageCommands = {
  list: async (filter: RuntimeFilter): Promise<ImageItem[]> => {
    const all = await fanOut(filter, async (rt) => {
      const raw = await invoke<Raw[]>('list_images', { runtime: rt });
      return raw.map((r) => parseImage(rt, r));
    });
    return dedupeBy(all, (i) => i.id);
  },
  remove: (rt: RuntimeName, id: string, force = true) =>
    invoke<void>('remove_image', { runtime: rt, id, force }),
  pull: (rt: RuntimeName, image: string) =>
    invoke<void>('pull_image', { runtime: rt, image }),
  push: (rt: RuntimeName, tag: string) =>
    invoke<void>('push_image', { runtime: rt, tag }),
  prune: (rt: RuntimeName) => invoke<string>('prune_images', { runtime: rt }),
  tag: (rt: RuntimeName, source: string, target: string) =>
    invoke<void>('tag_image', { runtime: rt, source, target }),
};

// ─── Volumes ─────────────────────────────────────────────────────────────────

export const VolumeCommands = {
  list: (filter: RuntimeFilter): Promise<Volume[]> =>
    fanOut(filter, async (rt) => {
      const raw = await invoke<Raw[]>('list_volumes', { runtime: rt });
      return raw.map((r) => parseVolume(rt, r));
    }),
  create: (rt: RuntimeName, name: string) =>
    invoke<void>('create_volume', { runtime: rt, name }),
  remove: (rt: RuntimeName, name: string, force = true) =>
    invoke<void>('remove_volume', { runtime: rt, name, force }),
  prune: (rt: RuntimeName) => invoke<string>('prune_volumes', { runtime: rt }),
};

// ─── Networks ────────────────────────────────────────────────────────────────

export const NetworkCommands = {
  list: (filter: RuntimeFilter): Promise<Network[]> =>
    fanOut(filter, async (rt) => {
      const raw = await invoke<Raw[]>('list_networks', { runtime: rt });
      return raw.map((r) => parseNetwork(rt, r));
    }),
};

// ─── Builds ──────────────────────────────────────────────────────────────────

export const BuildCommands = {
  list: () => invoke<BuildRecord[]>('list_builds'),
  start: (cfg: NewBuildConfig) => invoke<string>('start_build', { ...cfg }),
  cancel: (id: string) => invoke<void>('cancel_build', { id }),
  remove: (id: string) => invoke<void>('delete_build', { id }),
  readDockerfile: (path: string) => invoke<string>('read_dockerfile', { path }),
  clearHistory: () => invoke<void>('clear_build_history'),
};

// ─── System ──────────────────────────────────────────────────────────────────

export const SystemCommands = {
  prune: (rt: RuntimeName) => invoke<string>('system_prune', { runtime: rt }),
  openUrl: (url: string) => invoke<void>('open_url', { url }),
  quit: () => invoke<void>('quit_app'),
  setTranslucent: (enabled: boolean) =>
    invoke<void>('set_window_translucent', { enabled }),
};

// ─── Binary downloader ───────────────────────────────────────────────────────

export const BinaryCommands = {
  releases: (rt: RuntimeName) =>
    invoke<BinaryRelease[]>('get_available_releases', { runtime: rt }),
  download: (rt: RuntimeName, version: string, url: string, installDir: string) =>
    invoke<void>('download_binary', { runtime: rt, version, url, installDir }),
  defaultInstallDir: () => invoke<string>('get_default_install_dir'),
  verify: (path: string) => invoke<string>('verify_binary', { path }),
  addToPath: (dir: string) => invoke<void>('add_to_path', { dir }),
};
