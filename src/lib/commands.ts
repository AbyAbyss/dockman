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
  Problem,
  RuntimeFilter,
  RuntimeName,
  RuntimeScope,
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
  /** Podman only: whether the machine runs containers as root; null without a machine. */
  rootful: boolean | null;
  engineApp: string;
}

/** What a run / pull reports back beyond success. */
export interface RunResult {
  id: string;
  emulated: boolean;
  platform: string | null;
  /** True when the container runs as root inside the podman VM. */
  asRoot: boolean;
  /** Set when a detached container died right after starting and was diagnosed. */
  problem: Problem | null;
}

export interface PullResult {
  emulated: boolean;
  platform: string | null;
}

export interface ImageArch {
  id: string;
  names: string[];
  arch: string;
  emulated: boolean;
}

/** A structured failure from run / pull: the raw message plus a diagnosis. */
export interface Failure {
  message: string;
  problem: Problem | null;
}

/** Normalise anything a command rejected with into a `Failure`. */
export function failureOf(e: unknown): Failure {
  if (e && typeof e === 'object' && 'message' in e) {
    const f = e as { message: unknown; problem?: Problem | null };
    return { message: String(f.message), problem: f.problem ?? null };
  }
  return { message: String(e).replace(/^Error:\s*/, ''), problem: null };
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
  /** Optional resource limits — an omitted field leaves the runtime default. */
  memory?: string;
  memorySwap?: string;
  cpus?: string;
  storageSize?: string;
  /** Force a platform (`linux/amd64`); omitted = the runtime's default, with
   *  an automatic emulated retry when the image has no host-arch build. */
  platform?: string;
  /** Podman only: run this one container as root inside the VM (the
   *  machine's `-root` connection). Nothing on the Mac runs as root. */
  asRoot?: boolean;
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

/** Scopes a filter covers. Podman's root side is listed with podman, so
 *  containers run as root inside the VM are never hidden. */
function runtimesFor(filter: RuntimeFilter): RuntimeScope[] {
  if (filter === 'all') return ['docker', 'podman', 'podman-root'];
  if (filter === 'podman') return ['podman', 'podman-root'];
  return [filter];
}

/** The runtime a scope belongs to. */
export const baseRt = (s: RuntimeScope): RuntimeName => (s === 'podman-root' ? 'podman' : s);

/** Run a per-runtime fetch across the active filter, tolerating a missing runtime. */
async function fanOut<T>(
  filter: RuntimeFilter,
  fn: (rt: RuntimeScope) => Promise<T[]>,
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

/** Drop duplicates — when Docker and Podman share an engine (e.g. OrbStack,
 *  or podman-mac-helper pointing /var/run/docker.sock at the podman machine)
 *  the same object is reported by both CLIs. Podman's copy wins: the docker
 *  CLI is then only a client of the podman engine that actually owns it. */
function dedupeBy<T extends { rt: RuntimeName }>(items: T[], key: (x: T) => string): T[] {
  const byKey = new Map<string, number>();
  const out: T[] = [];
  for (const item of items) {
    const k = key(item);
    const at = k ? byKey.get(k) : undefined;
    if (at !== undefined) {
      if (item.rt === 'podman') out[at] = item;
      continue;
    }
    if (k) byKey.set(k, out.length);
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
/** A diagnosed problem found after a compose up (payload: `Problem`). */
export const COMPOSE_PROBLEM = 'compose-problem';

// ─── Runtime ─────────────────────────────────────────────────────────────────

export const RuntimeCommands = {
  detectAll: () => invoke<RuntimeInfo[]>('detect_all_runtimes'),
  setMode: (mode: string) => invoke<void>('set_runtime_mode', { mode }),
  setPath: (runtime: RuntimeName, path: string) =>
    invoke<void>('set_runtime_path', { runtime, path }),
  /** Native picker; resolves to the chosen path, or null if cancelled. */
  pickPath: (runtime: RuntimeName) =>
    invoke<string | null>('pick_runtime_path', { runtime }),
  startDaemon: (runtime: RuntimeName) =>
    invoke<void>('start_runtime_daemon', { runtime }),
  stopDaemon: (runtime: RuntimeName) =>
    invoke<void>('stop_runtime_daemon', { runtime }),
  setupStatus: (runtime: RuntimeName) =>
    invoke<SetupStatus>('get_setup_status', { runtime }),
  removeBinary: (runtime: RuntimeName) =>
    invoke<void>('remove_binary', { runtime }),
  /** Flip the podman machine between rootless and rootful (stops + restarts it). */
  setRootful: (enabled: boolean) =>
    invoke<void>('set_machine_rootful', { enabled }),
  /** Problems visible from an engine's configuration alone (rootless machine,
   *  Rosetta missing, shared socket). */
  engineProblems: (runtime: RuntimeName) =>
    invoke<Problem[]>('engine_problems', { runtime }),
};

// ─── Containers ──────────────────────────────────────────────────────────────

export const ContainerCommands = {
  list: async (filter: RuntimeFilter): Promise<Container[]> => {
    const all = await fanOut(filter, async (rt) => {
      const raw = await invoke<Raw[]>('list_containers', { runtime: rt, all: true });
      return raw.map((r) => ({ ...parseContainer(baseRt(rt), r), root: rt === 'podman-root' }));
    });
    return dedupeBy(all, (c) => c.id);
  },
  start: (rt: RuntimeScope, id: string) =>
    invoke<void>('start_container', { runtime: rt, id }),
  stop: (rt: RuntimeScope, id: string) =>
    invoke<void>('stop_container', { runtime: rt, id }),
  restart: (rt: RuntimeScope, id: string) =>
    invoke<void>('restart_container', { runtime: rt, id }),
  pause: (rt: RuntimeScope, id: string) =>
    invoke<void>('pause_container', { runtime: rt, id }),
  unpause: (rt: RuntimeScope, id: string) =>
    invoke<void>('unpause_container', { runtime: rt, id }),
  remove: (rt: RuntimeScope, id: string, force = true) =>
    invoke<void>('remove_container', { runtime: rt, id, force }),
  /** Rejects with a `Failure` (see `failureOf`) when the run fails. */
  run: (rt: RuntimeScope, cfg: RunContainerConfig) =>
    invoke<RunResult>('run_container', { runtime: rt, ...cfg }),
  /** Adjust a container's memory / CPU limits via `<runtime> update`. */
  update: (
    rt: RuntimeScope,
    id: string,
    memory?: string,
    memorySwap?: string,
    cpus?: string,
  ) =>
    invoke<void>('update_container', { runtime: rt, id, memory, memorySwap, cpus }),
  inspect: (rt: RuntimeScope, id: string) =>
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
  startLogs: (rt: RuntimeScope, id: string, tail = 200, timestamps = false) =>
    invoke<void>('get_container_logs', { runtime: rt, id, tail, timestamps }),
  stopLogs: (id: string) => invoke<void>('stop_container_logs', { id }),
  execStart: (
    rt: RuntimeScope,
    id: string,
    shell: string,
    cols?: number,
    rows?: number,
  ) => invoke<string>('exec_start', { runtime: rt, id, shell, cols, rows }),
  /** Raw keystrokes — the PTY, not this call, interprets them. */
  execInput: (sessionId: string, input: string) =>
    invoke<void>('exec_input', { sessionId, input }),
  execResize: (sessionId: string, cols: number, rows: number) =>
    invoke<void>('exec_resize', { sessionId, cols, rows }),
  execStop: (sessionId: string) => invoke<void>('exec_stop', { sessionId }),
};

// ─── Images ──────────────────────────────────────────────────────────────────

export const ImageCommands = {
  list: async (filter: RuntimeFilter): Promise<ImageItem[]> => {
    const all = await fanOut(filter, async (rt) => {
      const raw = await invoke<Raw[]>('list_images', { runtime: rt });
      return raw.map((r) => ({ ...parseImage(baseRt(rt), r), root: rt === 'podman-root' }));
    });
    return dedupeBy(all, (i) => i.id);
  },
  remove: (rt: RuntimeScope, id: string, force = true) =>
    invoke<void>('remove_image', { runtime: rt, id, force }),
  /** Rejects with a `Failure` (see `failureOf`) when the pull fails. */
  pull: (rt: RuntimeScope, image: string) =>
    invoke<PullResult>('pull_image', { runtime: rt, image }),
  /** Architecture of every local image, for the "emulated" label. */
  archs: (rt: RuntimeScope) => invoke<ImageArch[]>('image_archs', { runtime: rt }),
  push: (rt: RuntimeScope, tag: string) =>
    invoke<void>('push_image', { runtime: rt, tag }),
  prune: (rt: RuntimeScope) => invoke<string>('prune_images', { runtime: rt }),
  tag: (rt: RuntimeScope, source: string, target: string) =>
    invoke<void>('tag_image', { runtime: rt, source, target }),
};

// ─── Volumes ─────────────────────────────────────────────────────────────────

export const VolumeCommands = {
  list: (filter: RuntimeFilter): Promise<Volume[]> =>
    fanOut(filter, async (rt) => {
      const raw = await invoke<Raw[]>('list_volumes', { runtime: rt });
      return raw.map((r) => ({ ...parseVolume(baseRt(rt), r), root: rt === 'podman-root' }));
    }),
  create: (rt: RuntimeScope, name: string) =>
    invoke<void>('create_volume', { runtime: rt, name }),
  remove: (rt: RuntimeScope, name: string, force = true) =>
    invoke<void>('remove_volume', { runtime: rt, name, force }),
  prune: (rt: RuntimeScope) => invoke<string>('prune_volumes', { runtime: rt }),
};

// ─── Networks ────────────────────────────────────────────────────────────────

export const NetworkCommands = {
  list: (filter: RuntimeFilter): Promise<Network[]> =>
    fanOut(filter, async (rt) => {
      const raw = await invoke<Raw[]>('list_networks', { runtime: rt });
      return raw.map((r) => ({ ...parseNetwork(baseRt(rt), r), root: rt === 'podman-root' }));
    }),
};

// ─── Compose ─────────────────────────────────────────────────────────────────

export interface ComposeProject {
  name: string;
  status: string;
  configFile: string;
}

export const ComposeCommands = {
  /** Native file picker for a compose file; resolves to null if cancelled. */
  pickFile: () => invoke<string | null>('pick_compose_file'),
  /** Service names declared in a compose file. Throws when the runtime has no
   *  working compose provider — also used as an availability probe. */
  services: (rt: RuntimeScope, composeFile: string) =>
    invoke<string[]>('compose_services', { runtime: rt, composeFile }),
  /** Bring a compose project up. Streams `compose-output`; ends with a
   *  `compose-done` event. `scale` entries are `service=count` strings. */
  up: (rt: RuntimeScope, composeFile: string, detach = true, scale: string[] = []) =>
    invoke<void>('compose_up', { runtime: rt, composeFile, detach, scale }),
  /** Stop and remove a compose project's containers. */
  down: (rt: RuntimeScope, composeFile: string) =>
    invoke<void>('compose_down', { runtime: rt, composeFile, removeVolumes: false }),
  /** Running compose projects with their config-file paths. */
  list: async (rt: RuntimeScope): Promise<ComposeProject[]> => {
    const raw = await invoke<Array<Record<string, unknown>>>('list_compose_projects', {
      runtime: rt,
    });
    return raw.map((p) => ({
      name: String(p.Name ?? p.name ?? ''),
      status: String(p.Status ?? p.status ?? ''),
      configFile: String(p.ConfigFiles ?? p.configFiles ?? '')
        .split(',')[0]
        .trim(),
    }));
  },
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

export interface HostInfo {
  cores: number;
  memTotalBytes: number;
  diskTotalBytes: number;
  diskFreeBytes: number;
}

export const SystemCommands = {
  prune: (rt: RuntimeScope) => invoke<string>('system_prune', { runtime: rt }),
  openUrl: (url: string) => invoke<void>('open_url', { url }),
  hostInfo: () => invoke<HostInfo>('host_info'),
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
