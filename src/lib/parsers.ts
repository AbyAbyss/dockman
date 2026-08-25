// Normalisers — turn the raw JSON the Docker / Podman CLIs emit into the app's
// own entity types. Docker and Podman differ in field names, casing and
// structure, so every accessor is deliberately tolerant.

import type {
  Container,
  ContainerStatus,
  ImageItem,
  Network,
  RuntimeName,
  Volume,
} from '@/types';

export type Raw = Record<string, unknown>;

function str(o: Raw, ...keys: string[]): string {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === 'string' && v) return v;
    if (typeof v === 'number') return String(v);
  }
  return '';
}

function firstName(v: unknown): string {
  if (Array.isArray(v)) return typeof v[0] === 'string' ? v[0] : '';
  if (typeof v === 'string') return v.split(',')[0].trim();
  return '';
}

function labelsOf(v: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    for (const [k, val] of Object.entries(v as Raw)) out[k] = String(val);
  } else if (typeof v === 'string') {
    for (const part of v.split(',')) {
      const eq = part.indexOf('=');
      if (eq > 0) out[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
    }
  }
  return out;
}

function mapState(s: string): ContainerStatus {
  const v = s.toLowerCase();
  if (v.includes('pause')) return 'paused';
  if (v.includes('run') || v.startsWith('up')) return 'running';
  return 'stopped';
}

function parsePorts(v: unknown): string {
  if (typeof v === 'string') return v || '—';
  if (Array.isArray(v)) {
    const parts = v
      .map((p) => {
        if (p && typeof p === 'object') {
          const o = p as Raw;
          const hp = o.host_port ?? o.hostPort;
          const cp = o.container_port ?? o.containerPort;
          if (hp && cp) return `${hp}:${cp}`;
          if (cp) return String(cp);
        }
        return '';
      })
      .filter(Boolean);
    return parts.length ? parts.join(', ') : '—';
  }
  return '—';
}

export function formatBytes(n: number): string {
  if (n >= 1 << 30) return `${(n / (1 << 30)).toFixed(2)} GB`;
  if (n >= 1 << 20) return `${Math.round(n / (1 << 20))} MB`;
  if (n >= 1 << 10) return `${Math.round(n / (1 << 10))} KB`;
  return `${n} B`;
}

function relAge(epochSec: unknown): string {
  if (typeof epochSec !== 'number' || epochSec <= 0) return '';
  const diff = Date.now() / 1000 - epochSec;
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)}h ago`;
  return `${Math.round(diff / 86400)}d ago`;
}

export function parseContainer(rt: RuntimeName, o: Raw): Container {
  const rawId = str(o, 'ID', 'Id');
  const id = rawId.slice(0, 12) || `${rt}-${Math.random().toString(16).slice(2, 8)}`;
  const labels = labelsOf(o.Labels);
  const service = labels['com.docker.compose.service'] || '';
  const stateRaw = str(o, 'State') || str(o, 'Status');
  return {
    id,
    rt,
    name: firstName(o.Names) || str(o, 'Names') || id,
    image: str(o, 'Image'),
    status: mapState(stateRaw),
    cpu: 0,
    mem: 0,
    port: parsePorts(o.Ports),
    uptime: str(o, 'Status', 'RunningFor') || '—',
    tag: service ? 'service' : 'container',
    stack: labels['com.docker.compose.project'] || 'standalone',
  };
}

export function parseImage(rt: RuntimeName, o: Raw): ImageItem {
  let name = str(o, 'Repository');
  let tag = str(o, 'Tag');
  if (!name) {
    const ref = firstName(o.Names) || firstName(o.RepoTags);
    if (ref) {
      const colon = ref.lastIndexOf(':');
      name = colon > 0 ? ref.slice(0, colon) : ref;
      tag = colon > 0 ? ref.slice(colon + 1) : 'latest';
    }
  }
  const size =
    typeof o.Size === 'number' ? formatBytes(o.Size) : str(o, 'Size') || '—';
  return {
    id: str(o, 'ID', 'Id').replace(/^sha256:/, '').slice(0, 19),
    rt,
    name: name || '<none>',
    tag: tag || 'latest',
    size,
    built: str(o, 'CreatedSince', 'CreatedAt') || relAge(o.Created) || '—',
    used: false,
    layers: 0,
    pulls: 0,
  };
}

export function parseVolume(rt: RuntimeName, o: Raw): Volume {
  return {
    name: str(o, 'Name'),
    rt,
    size: str(o, 'Size') || '—',
    used: 0,
    mount: str(o, 'Mountpoint'),
    driver: str(o, 'Driver') || 'local',
    attached: '—',
    created: str(o, 'CreatedAt') || '—',
  };
}

export function parseNetwork(rt: RuntimeName, o: Raw): Network {
  return {
    name: str(o, 'Name'),
    rt,
    driver: str(o, 'Driver') || 'bridge',
    scope: str(o, 'Scope') || 'local',
    subnet: str(o, 'Subnet') || '—',
    gateway: str(o, 'Gateway') || '—',
    attached: 0,
    ext: false,
  };
}

/** Convert a CLI memory string ("24.3MiB / 7.65GiB") to megabytes. */
function memToMB(s: string): number {
  const first = s.split('/')[0].trim();
  const m = first.match(/([\d.]+)\s*([A-Za-z]*)/);
  if (!m) return 0;
  const v = parseFloat(m[1]);
  const unit = m[2].toLowerCase();
  if (unit.startsWith('g')) return v * 1024;
  if (unit.startsWith('k')) return v / 1024;
  if (unit.startsWith('b') || unit === '') return v / (1024 * 1024);
  return v; // MiB / MB
}

export interface ContainerStat {
  id: string;
  name: string;
  cpu: number;
  mem: number;
}

/** Normalise one `docker/podman stats` row. */
export function parseStat(o: Raw): ContainerStat {
  return {
    id: str(o, 'ID', 'Id', 'Container', 'ContainerID').slice(0, 12),
    name: str(o, 'Name', 'name'),
    cpu: parseFloat(str(o, 'CPUPerc', 'cpu_percent', 'CPU')) || 0,
    mem: Math.round(memToMB(str(o, 'MemUsage', 'mem_usage', 'MemoryUsage'))),
  };
}

// ─── Ports ───────────────────────────────────────────────────────────────────

export interface PortBinding {
  /** Host port, when the container port is published. */
  host: string | null;
  container: string;
  proto: string;
}

/**
 * Split the runtime's port string into bindings.
 *
 * The CLIs emit things like
 *   `0.0.0.0:1025->1025/tcp, [::]:8025->8025/tcp, 1110/tcp`
 * which is far too long to show verbatim in a table cell — it wrapped to three
 * lines and blew out the row height. Published bindings are what a user acts
 * on, so they come first and unpublished ones are counted separately.
 */
export function splitPorts(raw: string): PortBinding[] {
  if (!raw || raw === '—') return [];
  const seen = new Set<string>();
  const out: PortBinding[] = [];
  for (const part of raw.split(',').map((p) => p.trim()).filter(Boolean)) {
    // Runtime form: `<addr>:<host>-><container>/<proto>`, or `<container>/<proto>`
    // when unpublished. The seed data uses the shorter `<host>:<container>`
    // and bare `<port>` forms, so both are accepted.
    const published = part.match(/^(?:.*:)?(\d+)->(\d+)\/(\w+)$/);
    const internal = part.match(/^(\d+)\/(\w+)$/);
    const pair = part.match(/^(\d+):(\d+)$/);
    const bare = part.match(/^(\d+)$/);
    let b: PortBinding | null = null;
    if (published) b = { host: published[1], container: published[2], proto: published[3] };
    else if (internal) b = { host: null, container: internal[1], proto: internal[2] };
    else if (pair) b = { host: pair[1], container: pair[2], proto: 'tcp' };
    else if (bare) b = { host: bare[1], container: bare[1], proto: 'tcp' };
    if (!b) continue;
    // IPv4 and IPv6 bindings of the same port arrive as separate entries.
    const key = `${b.host ?? '-'}:${b.container}/${b.proto}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(b);
  }
  return out;
}
