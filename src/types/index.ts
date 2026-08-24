// Domain types for Dockman. Entity shapes mirror what the Docker / Podman
// CLIs return once normalised; the seed data in src/data/seed.ts conforms here.

export type RuntimeName = 'docker' | 'podman';

/** Active runtime filter — 'all' shows both runtimes in a unified view. */
export type RuntimeFilter = 'all' | RuntimeName;

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
