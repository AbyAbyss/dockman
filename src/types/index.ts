// Domain types for Dockman. Entity shapes mirror what the Docker / Podman
// CLIs return once normalised.

export type RuntimeName = 'docker' | 'podman';

/** Active runtime filter — 'all' shows both runtimes in a unified view. */
export type RuntimeFilter = 'all' | RuntimeName;

export type ContainerStatus = 'running' | 'paused' | 'stopped';

export interface PortMapping {
  host: string;
  container: string;
  protocol: string;
}

export interface Container {
  id: string;
  rt: RuntimeName;
  name: string;
  image: string;
  status: ContainerStatus;
  cpu: number;
  mem: number;
  /** Short summary, e.g. "8080:80, 8443:443". */
  port: string;
  ports: PortMapping[];
  networks: string[];
  uptime: string;
  tag: string;
  stack: string;
}

export interface ImageItem {
  id: string;
  rt: RuntimeName;
  name: string;
  tag: string;
  size: string;
  sizeBytes: number;
  built: string;
}

export interface Volume {
  name: string;
  rt: RuntimeName;
  /** Formatted size when the runtime reports one, otherwise "—". */
  size: string;
  sizeBytes: number;
  mount: string;
  driver: string;
  /** Names of containers mounting this volume. */
  attachedTo: string[];
  created: string;
}

export interface Network {
  name: string;
  rt: RuntimeName;
  driver: string;
  scope: string;
  subnet: string;
  gateway: string;
  /** Containers attached, from the container inventory. */
  attached: number;
  internal: boolean;
}

export type ActivityKind =
  | 'start'
  | 'stop'
  | 'pause'
  | 'restart'
  | 'remove'
  | 'run'
  | 'pull'
  | 'build'
  | 'prune'
  | 'fallback'
  | 'install'
  | 'error';

export interface ActivityEntry {
  /** Unix milliseconds. */
  at: number;
  rt: RuntimeName;
  kind: ActivityKind;
  target: string;
  note: string;
}

export interface RuntimeMeta {
  name: string;
  short: string;
  found: boolean;
  version: string;
  path: string;
  arch: string;
  running: boolean;
  accent: string;
  soft: string;
}

// ─── Builds ──────────────────────────────────────────────────────────────────

export type BuildStatus = 'success' | 'failed' | 'running' | 'cancelled';

export interface BuildLayer {
  step: number;
  instruction: string;
  cached: boolean;
  durationMs: number;
}

export interface BuildRecord {
  id: string;
  rt: RuntimeName;
  tag: string;
  status: BuildStatus;
  when: string;
  duration: string;
  cachePercent: number;
  size: string;
  finalSize: string;
  layerCount: number;
  dockerfile: string;
  layers: BuildLayer[];
  createdAt: number;
  dockerfilePath: string;
  contextPath: string;
  error: string;
}

// ─── Theme ───────────────────────────────────────────────────────────────────

export type PaletteName = 'ink' | 'paper' | 'slate';
export type AccentName = 'violet' | 'olive' | 'terracotta' | 'cobalt';
export type TabPosition = 'top' | 'left';
export type TabKey =
  | 'overview'
  | 'containers'
  | 'images'
  | 'volumes'
  | 'networks'
  | 'builds'
  | 'binary'
  | 'settings';
