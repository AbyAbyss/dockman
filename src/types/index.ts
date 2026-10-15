// Domain types for Dockman. Entity shapes mirror what the Docker / Podman
// CLIs return once normalised; the seed data in src/data/seed.ts conforms here.

export type RuntimeName = 'docker' | 'podman';

/** Active runtime filter — 'all' shows both runtimes in a unified view. */
export type RuntimeFilter = 'all' | RuntimeName;

/** What a backend command is aimed at: a runtime, or podman's root
 *  connection for objects that run as root inside the VM. */
export type RuntimeScope = RuntimeName | 'podman-root';

/** Objects that belong to a runtime and may live on podman's root side. */
export interface Scoped {
  rt: RuntimeName;
  root?: boolean;
}

export const scopeOf = (x: Scoped): RuntimeScope =>
  x.rt === 'podman' && x.root ? 'podman-root' : x.rt;

export type ContainerStatus = 'running' | 'paused' | 'stopped';

/** Container table status filter — 'all' plus each concrete status. */
export type StatusFilter = 'all' | ContainerStatus;

export interface Container {
  id: string;
  rt: RuntimeName;
  name: string;
  image: string;
  status: ContainerStatus;
  cpu: number;
  mem: number;
  port: string;
  uptime: string;
  tag: string;
  stack: string;
  /** Image id as the runtime reports it (podman only; docker's list omits it). */
  imageId?: string;
  /** Architecture of the container's image, when known ('amd64', 'arm64'). */
  arch?: string;
  /** True when the image's architecture differs from this Mac's. */
  emulated?: boolean;
  /** True when the container runs as root inside the podman VM. */
  root?: boolean;
}

// ─── Diagnosed problems ──────────────────────────────────────────────────────

export type ProblemSeverity = 'info' | 'warning' | 'error';

export interface ProblemFix {
  label: string;
  /** One-click action the app performs: `set_rootful`, `open_engines`, `retry_platform`. */
  action?: string | null;
  /** Command shown for the terminal (copyable). */
  command?: string | null;
}

/** A known failure mode, diagnosed by the backend, with its cause and fixes. */
export interface Problem {
  code: string;
  severity: ProblemSeverity;
  engine: RuntimeName;
  container?: string | null;
  image?: string | null;
  /** Compose file, when the problem belongs to a stack. */
  file?: string | null;
  message: string;
  cause: string;
  fixes: ProblemFix[];
  logTail: string;
}

/** A problem as held in the store: keyed for dedupe, with its origin. */
export interface ProblemEntry extends Problem {
  key: string;
  /** `probe` problems are refreshed by the engine poll; `event` ones stay until dismissed. */
  source: 'probe' | 'event';
  at: number;
}

export interface ImageItem {
  id: string;
  rt: RuntimeName;
  name: string;
  tag: string;
  size: string;
  built: string;
  used: boolean;
  layers: number;
  pulls: number;
  /** True when the image lives in podman's root store. */
  root?: boolean;
}

export interface Volume {
  name: string;
  rt: RuntimeName;
  size: string;
  used: number;
  mount: string;
  driver: string;
  attached: string;
  created: string;
  root?: boolean;
}

export interface Network {
  name: string;
  rt: RuntimeName;
  driver: string;
  scope: string;
  subnet: string;
  gateway: string;
  attached: number;
  ext: boolean;
  root?: boolean;
}

export type ActivityKind = 'start' | 'stop' | 'pull' | 'build' | 'prune' | 'fallback';

export interface ActivityEntry {
  t: string;
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
  latest: string;
}

export interface BinaryVersion {
  v: string;
  size: string;
  released: string;
  tag: string;
  recommended?: boolean;
}

export interface BinaryManifest {
  platform: string;
  source: string;
  versions: BinaryVersion[];
}

export interface DownloadHistoryEntry {
  rt: RuntimeName;
  v: string;
  when: string;
  status: string;
  path: string;
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
}

export interface CacheImage {
  name: string;
  layers: number;
}

export interface LayerCacheInfo {
  totalSize: string;
  cachedLayers: number;
  images: CacheImage[];
}

// ─── Theme ───────────────────────────────────────────────────────────────────

/** Visual personality: shape, density, motion and colour. `playful` carries
 *  its own palette, so it overrides the palette / accent choice below. */
export type ThemeMode = 'serious' | 'playful';

export type PaletteName = 'ink' | 'paper' | 'slate';
export type AccentName = 'violet' | 'olive' | 'terracotta' | 'cobalt';

export type TabKey =
  | 'overview'
  | 'containers'
  | 'images'
  | 'volumes'
  | 'networks'
  | 'builds'
  | 'binary'
  | 'settings';
