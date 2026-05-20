// Seed data for Dockman.
//
// The design prototype is mock-data driven; this module is the typed port of
// data.jsx plus the Builds dataset. When the Tauri backend is wired in, the
// command bridge (src/lib/commands.ts) replaces these with live CLI results.

import type {
  ActivityEntry,
  BinaryManifest,
  BuildLayer,
  BuildRecord,
  Container,
  DownloadHistoryEntry,
  ImageItem,
  LayerCacheInfo,
  Network,
  RuntimeMeta,
  RuntimeName,
  Volume,
} from '@/types';

export const INITIAL_CONTAINERS: Container[] = [
  { id: 'c-7f2a', rt: 'docker', name: 'postgres-main',     image: 'postgres:16-alpine',     status: 'running', cpu: 2.4, mem: 312, port: '5432:5432', uptime: '4d 12h',  tag: 'database',      stack: 'data-store' },
  { id: 'c-9b14', rt: 'docker', name: 'redis-cache',       image: 'redis:7.2',              status: 'running', cpu: 0.6, mem: 84,  port: '6379:6379', uptime: '4d 12h',  tag: 'cache',         stack: 'data-store' },
  { id: 'c-1d8e', rt: 'docker', name: 'api-gateway',       image: 'dockman/api-gw:0.14.2',  status: 'running', cpu: 8.1, mem: 412, port: '8080:8080', uptime: '1d 03h',  tag: 'service',       stack: 'api-platform' },
  { id: 'c-3c47', rt: 'docker', name: 'worker-billing',    image: 'dockman/worker:0.14.2',  status: 'running', cpu: 1.2, mem: 168, port: '—',         uptime: '1d 03h',  tag: 'service',       stack: 'api-platform' },
  { id: 'c-6e29', rt: 'podman', name: 'minio-storage',     image: 'minio/minio:RELEASE',    status: 'paused',  cpu: 0,   mem: 96,  port: '9000:9000', uptime: '—',       tag: 'storage',       stack: 'data-store' },
  { id: 'c-2a55', rt: 'podman', name: 'mailhog-dev',       image: 'mailhog/mailhog:latest', status: 'stopped', cpu: 0,   mem: 0,   port: '1025,8025', uptime: '—',       tag: 'dev-tool',      stack: 'api-platform' },
  { id: 'c-8f31', rt: 'docker', name: 'prometheus',        image: 'prom/prometheus:v2.51',  status: 'running', cpu: 1.8, mem: 224, port: '9090:9090', uptime: '6d 21h',  tag: 'observability', stack: 'observability' },
  { id: 'c-4b72', rt: 'docker', name: 'grafana',           image: 'grafana/grafana:10.4',   status: 'running', cpu: 0.9, mem: 142, port: '3001:3000', uptime: '6d 21h',  tag: 'observability', stack: 'observability' },
  { id: 'c-5e90', rt: 'podman', name: 'nginx-edge',        image: 'nginx:1.27-alpine',      status: 'running', cpu: 0.3, mem: 22,  port: '80,443',    uptime: '12d 04h', tag: 'service',       stack: 'api-platform' },
  { id: 'c-0a13', rt: 'podman', name: 'jaeger-tracing',    image: 'jaegertracing/all-in-1', status: 'stopped', cpu: 0,   mem: 0,   port: '16686',     uptime: '—',       tag: 'observability', stack: 'observability' },
  { id: 'c-b3f8', rt: 'podman', name: 'meilisearch',       image: 'getmeili/meilisearch',   status: 'running', cpu: 1.1, mem: 198, port: '7700:7700', uptime: '2d 08h',  tag: 'service',       stack: 'api-platform' },
  { id: 'c-e571', rt: 'docker', name: 'clickhouse-events', image: 'clickhouse:24.3',        status: 'paused',  cpu: 0,   mem: 140, port: '8123,9000', uptime: '—',       tag: 'database',      stack: 'data-store' },
];

export const INITIAL_IMAGES: ImageItem[] = [
  { id: 'sha256:7a2b', rt: 'docker', name: 'dockman/api-gw',  tag: '0.14.2',      size: '142 MB',  built: '2h ago', used: true,  layers: 12, pulls: 1248 },
  { id: 'sha256:b41c', rt: 'docker', name: 'dockman/worker',  tag: '0.14.2',      size: '138 MB',  built: '2h ago', used: true,  layers: 11, pulls: 892 },
  { id: 'sha256:2e9a', rt: 'docker', name: 'postgres',        tag: '16-alpine',   size: '241 MB',  built: '6d ago', used: true,  layers: 14, pulls: 22810 },
  { id: 'sha256:91da', rt: 'docker', name: 'redis',           tag: '7.2',         size: '32 MB',   built: '3w ago', used: true,  layers: 7,  pulls: 31002 },
  { id: 'sha256:0c4f', rt: 'podman', name: 'nginx',           tag: '1.27-alpine', size: '48 MB',   built: '1w ago', used: true,  layers: 8,  pulls: 41209 },
  { id: 'sha256:f3b6', rt: 'docker', name: 'prom/prometheus', tag: 'v2.51',       size: '218 MB',  built: '2w ago', used: true,  layers: 10, pulls: 9482 },
  { id: 'sha256:5a08', rt: 'docker', name: 'grafana/grafana', tag: '10.4',        size: '326 MB',  built: '2w ago', used: true,  layers: 13, pulls: 11420 },
  { id: 'sha256:c901', rt: 'podman', name: 'minio/minio',     tag: 'RELEASE',     size: '156 MB',  built: '1m ago', used: true,  layers: 9,  pulls: 7220 },
  { id: 'sha256:7777', rt: 'docker', name: 'dockman/api-gw',  tag: '0.14.1',      size: '142 MB',  built: '1d ago', used: false, layers: 12, pulls: 980 },
  { id: 'sha256:4123', rt: 'docker', name: 'dockman/api-gw',  tag: '0.14.0',      size: '141 MB',  built: '4d ago', used: false, layers: 12, pulls: 612 },
  { id: 'sha256:dd2a', rt: 'podman', name: 'node',            tag: '20-bookworm', size: '1.04 GB', built: '2w ago', used: false, layers: 17, pulls: 51029 },
];

export const INITIAL_VOLUMES: Volume[] = [
  { name: 'pg-data',         rt: 'docker', size: '2.1 GB', used: 84, mount: '/var/lib/postgresql/data', driver: 'local', attached: 'postgres-main', created: '4d ago' },
  { name: 'minio-objects',   rt: 'podman', size: '842 MB', used: 36, mount: '/data',                    driver: 'local', attached: 'minio-storage', created: '12d ago' },
  { name: 'prometheus-tsdb', rt: 'docker', size: '1.4 GB', used: 58, mount: '/prometheus',              driver: 'local', attached: 'prometheus',    created: '14d ago' },
  { name: 'grafana-state',   rt: 'docker', size: '88 MB',  used: 14, mount: '/var/lib/grafana',         driver: 'local', attached: 'grafana',       created: '14d ago' },
  { name: 'redis-aof',       rt: 'docker', size: '14 MB',  used: 6,  mount: '/data',                    driver: 'local', attached: 'redis-cache',   created: '4d ago' },
  { name: 'meili-index',     rt: 'podman', size: '198 MB', used: 21, mount: '/meili_data',              driver: 'local', attached: 'meilisearch',   created: '2d ago' },
  { name: 'click-store',     rt: 'docker', size: '512 MB', used: 19, mount: '/var/lib/clickhouse',      driver: 'local', attached: '—',             created: '8d ago' },
  { name: 'tmp-build-cache', rt: 'podman', size: '64 MB',  used: 3,  mount: '/cache',                   driver: 'local', attached: '—',             created: '1d ago' },
];

export const INITIAL_NETWORKS: Network[] = [
  { name: 'dockman-backend', rt: 'docker', driver: 'bridge', scope: 'local', subnet: '172.20.0.0/16', gateway: '172.20.0.1', attached: 6, ext: false },
  { name: 'dockman-edge',    rt: 'podman', driver: 'bridge', scope: 'local', subnet: '172.21.0.0/16', gateway: '172.21.0.1', attached: 2, ext: true },
  { name: 'observability',   rt: 'docker', driver: 'bridge', scope: 'local', subnet: '172.22.0.0/16', gateway: '172.22.0.1', attached: 3, ext: false },
  { name: 'host',            rt: 'docker', driver: 'host',   scope: 'local', subnet: '—',             gateway: '—',          attached: 0, ext: false },
  { name: 'podman',          rt: 'podman', driver: 'bridge', scope: 'local', subnet: '10.88.0.0/16',  gateway: '10.88.0.1',  attached: 4, ext: false },
];

export const ACTIVITY: ActivityEntry[] = [
  { t: '12:04:18', rt: 'docker', kind: 'start',    target: 'api-gateway',    note: 'image dockman/api-gw:0.14.2' },
  { t: '12:04:11', rt: 'docker', kind: 'pull',     target: 'dockman/api-gw', note: '0.14.2 · 142 MB · 4.1s' },
  { t: '12:03:02', rt: 'podman', kind: 'fallback', target: 'api-gateway',    note: 'arch mismatch — retried on docker' },
  { t: '11:58:40', rt: 'podman', kind: 'start',    target: 'nginx-edge',     note: 'image nginx:1.27-alpine' },
  { t: '11:41:09', rt: 'docker', kind: 'pull',     target: 'dockman/worker', note: '0.14.2 · 138 MB · 3.8s' },
  { t: '10:12:55', rt: 'podman', kind: 'stop',     target: 'mailhog-dev',    note: 'manual' },
  { t: '09:48:22', rt: 'docker', kind: 'start',    target: 'prometheus',     note: 'restart on update' },
  { t: '09:14:01', rt: 'docker', kind: 'prune',    target: 'images',         note: 'reclaimed 1.2 GB' },
];

export const RUNTIMES: Record<RuntimeName, RuntimeMeta> = {
  docker: {
    name: 'Docker',
    short: 'docker',
    found: true,
    version: '26.1.4',
    path: '/usr/local/bin/docker',
    arch: 'arm64',
    running: true,
    accent: '#2496ed',
    soft: 'rgba(36,150,237,0.18)',
    latest: '26.1.4',
  },
  podman: {
    name: 'Podman',
    short: 'podman',
    found: true,
    version: '5.1.1',
    path: '/opt/homebrew/bin/podman',
    arch: 'arm64',
    running: true,
    accent: '#892ca0',
    soft: 'rgba(137,44,160,0.20)',
    latest: '5.1.1',
  },
};

export const BINARY_MANIFEST: Record<RuntimeName, BinaryManifest> = {
  docker: {
    platform: 'macOS arm64',
    source: 'download.docker.com/mac/static/stable/aarch64',
    versions: [
      { v: '26.1.4', size: '64 MB', released: '2026-04-10', tag: 'latest stable', recommended: true },
      { v: '26.1.3', size: '64 MB', released: '2026-03-22', tag: 'stable' },
      { v: '25.0.5', size: '63 MB', released: '2026-01-19', tag: 'stable' },
      { v: '24.0.9', size: '62 MB', released: '2025-12-15', tag: 'legacy' },
    ],
  },
  podman: {
    platform: 'macOS arm64',
    source: 'github.com/containers/podman/releases',
    versions: [
      { v: '5.1.1', size: '48 MB', released: '2026-05-02', tag: 'latest stable', recommended: true },
      { v: '5.0.3', size: '47 MB', released: '2026-04-04', tag: 'stable' },
      { v: '4.9.4', size: '45 MB', released: '2025-12-14', tag: 'stable' },
      { v: '4.8.3', size: '44 MB', released: '2025-11-09', tag: 'legacy' },
    ],
  },
};

export const DOWNLOAD_HISTORY: DownloadHistoryEntry[] = [
  { rt: 'docker', v: '26.1.4', when: '2h ago',    status: 'success',  path: '/usr/local/bin/docker' },
  { rt: 'podman', v: '5.1.1',  when: 'yesterday', status: 'success',  path: '/opt/homebrew/bin/podman' },
  { rt: 'podman', v: '5.0.3',  when: '3w ago',    status: 'replaced', path: '—' },
];

// 24 samples for sparklines.
export const CPU_SPARK = [12, 14, 18, 22, 19, 17, 15, 21, 28, 34, 42, 38, 31, 29, 27, 33, 41, 48, 44, 39, 36, 32, 28, 26];
export const MEM_SPARK = [38, 39, 41, 42, 44, 44, 45, 46, 48, 51, 53, 52, 51, 52, 54, 56, 58, 60, 61, 60, 59, 58, 57, 57];
export const NET_SPARK = [4, 6, 8, 5, 9, 12, 18, 22, 16, 11, 8, 6, 5, 7, 14, 19, 24, 28, 22, 17, 14, 12, 10, 9];

// ─── Builds ──────────────────────────────────────────────────────────────────

const API_GW_DOCKERFILE = `# syntax=docker/dockerfile:1.7
FROM node:20-bookworm AS builder
WORKDIR /app
COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm \\
    npm ci --omit=dev
COPY src ./src
COPY tsconfig.json ./
RUN npm run build

FROM gcr.io/distroless/nodejs20-debian12
COPY --from=builder /app/dist /app
COPY --from=builder /app/node_modules /app/node_modules
WORKDIR /app
EXPOSE 8080
CMD ["server.js"]
`;

const WORKER_DOCKERFILE = `# syntax=docker/dockerfile:1.7
FROM node:20-bookworm AS builder
WORKDIR /app
COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm \\
    npm ci --omit=dev
COPY src ./src
RUN npm run build

FROM gcr.io/distroless/nodejs20-debian12
COPY --from=builder /app/dist /app
COPY --from=builder /app/node_modules /app/node_modules
WORKDIR /app
CMD ["worker.js"]
`;

const API_GW_STEPS = [
  'FROM node:20-bookworm AS builder',
  'WORKDIR /app',
  'COPY package*.json ./',
  'RUN npm ci --omit=dev',
  'COPY src ./src',
  'COPY tsconfig.json ./',
  'RUN npm run build',
  'FROM gcr.io/distroless/nodejs20-debian12',
  'COPY --from=builder /app/dist /app',
  'COPY --from=builder /app/node_modules',
  'EXPOSE 8080',
  'CMD ["server.js"]',
];

const WORKER_STEPS = [
  'FROM node:20-bookworm AS builder',
  'WORKDIR /app',
  'COPY package*.json ./',
  'RUN npm ci --omit=dev',
  'COPY src ./src',
  'RUN npm run build',
  'FROM gcr.io/distroless/nodejs20-debian12',
  'COPY --from=builder /app/dist /app',
  'COPY --from=builder /app/node_modules',
  'WORKDIR /app',
  'CMD ["worker.js"]',
];

/** Build a deterministic layer waterfall from instruction list + cache hit %. */
function makeLayers(steps: string[], cachePercent: number): BuildLayer[] {
  const cachedCount = Math.round((steps.length * cachePercent) / 100);
  return steps.map((instruction, i) => {
    const cached = i < cachedCount;
    const durationMs = cached
      ? 120 + ((i * 53) % 420)
      : 1100 + ((i * 317) % 4200);
    return { step: i + 1, instruction, cached, durationMs };
  });
}

export const INITIAL_BUILDS: BuildRecord[] = [
  {
    id: 'b-9a01', rt: 'docker', tag: 'dockman/api-gw:0.14.2', status: 'success',
    when: '2h ago', duration: '12s', cachePercent: 92, size: '142 MB', finalSize: '142 MB',
    layerCount: 12, dockerfile: API_GW_DOCKERFILE, layers: makeLayers(API_GW_STEPS, 92),
  },
  {
    id: 'b-9a02', rt: 'docker', tag: 'dockman/worker:0.14.2', status: 'success',
    when: '2h ago', duration: '18s', cachePercent: 88, size: '138 MB', finalSize: '138 MB',
    layerCount: 11, dockerfile: WORKER_DOCKERFILE, layers: makeLayers(WORKER_STEPS, 88),
  },
  {
    id: 'b-8c14', rt: 'docker', tag: 'dockman/api-gw:0.14.1', status: 'success',
    when: '1d ago', duration: '1m04s', cachePercent: 41, size: '142 MB', finalSize: '142 MB',
    layerCount: 12, dockerfile: API_GW_DOCKERFILE, layers: makeLayers(API_GW_STEPS, 41),
  },
  {
    id: 'b-8c0f', rt: 'docker', tag: 'dockman/api-gw:0.14.0', status: 'failed',
    when: '4d ago', duration: '32s', cachePercent: 75, size: '—', finalSize: '—',
    layerCount: 12, dockerfile: API_GW_DOCKERFILE, layers: makeLayers(API_GW_STEPS, 75),
  },
  {
    id: 'b-7b22', rt: 'podman', tag: 'dockman/worker:0.14.0', status: 'success',
    when: '4d ago', duration: '24s', cachePercent: 80, size: '137 MB', finalSize: '137 MB',
    layerCount: 11, dockerfile: WORKER_DOCKERFILE, layers: makeLayers(WORKER_STEPS, 80),
  },
  {
    id: 'b-6f30', rt: 'docker', tag: 'dockman/api-gw:0.13.9', status: 'success',
    when: '1w ago', duration: '2m08s', cachePercent: 12, size: '141 MB', finalSize: '141 MB',
    layerCount: 12, dockerfile: API_GW_DOCKERFILE, layers: makeLayers(API_GW_STEPS, 12),
  },
];

export const LAYER_CACHE: LayerCacheInfo = {
  totalSize: '2.4 GB',
  cachedLayers: 38,
  images: [
    { name: 'node:20', layers: 8 },
    { name: 'distroless', layers: 4 },
    { name: 'alpine:3.20', layers: 1 },
    { name: 'python:3.12', layers: 2 },
    { name: 'postgres:16', layers: 4 },
    { name: 'redis:7', layers: 2 },
  ],
};
