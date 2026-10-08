// Normalisers — turn the raw JSON the Docker / Podman CLIs emit into the app's
// own entity types. Docker and Podman differ in field names, casing and
// structure, so every accessor is deliberately tolerant.

import type {
  Container,
  ContainerStatus,
  ImageItem,
  Network,
  PortMapping,
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

function list(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string');
  if (typeof v === 'string')
    return v
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  return [];
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

/** Docker: "0.0.0.0:8080->80/tcp, :::8080->80/tcp". Podman: objects. */
export function parsePorts(v: unknown): PortMapping[] {
  const out: PortMapping[] = [];
  const seen = new Set<string>();
  const push = (p: PortMapping) => {
    const key = `${p.host}:${p.container}/${p.protocol}`;
    if (p.host && !seen.has(key)) {
      seen.add(key);
      out.push(p);
    }
  };
  if (typeof v === 'string') {
    for (const part of v.split(',')) {
      const m = part.trim().match(/^(?:(.*):)?(\d+)->(\d+)\/(\w+)$/);
      if (m) push({ host: m[2], container: m[3], protocol: m[4] });
    }
  } else if (Array.isArray(v)) {
    for (const p of v) {
      if (!p || typeof p !== 'object') continue;
      const o = p as Raw;
      const hp = o.host_port ?? o.hostPort;
      const cp = o.container_port ?? o.containerPort;
      if (hp && cp)
        push({
          host: String(hp),
          container: String(cp),
          protocol: str(o, 'protocol') || 'tcp',
        });
    }
  }
  return out;
}

export function formatBytes(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)} GB`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} MB`;
  if (n >= 1e3) return `${Math.round(n / 1e3)} kB`;
  return `${Math.round(n)} B`;
}

/** Convert a CLI size string ("12.19MB", "764KiB", "0B") to bytes. */
export function sizeToBytes(s: string): number {
  const m = s.trim().match(/^([\d.]+)\s*([A-Za-z]*)/);
  if (!m) return 0;
  const v = parseFloat(m[1]);
  const unit = m[2].toLowerCase();
  const mult: Record<string, number> = {
    '': 1,
    b: 1,
    kb: 1e3,
    mb: 1e6,
    gb: 1e9,
    tb: 1e12,
    kib: 1024,
    mib: 1024 ** 2,
    gib: 1024 ** 3,
    tib: 1024 ** 4,
  };
  return Math.round(v * (mult[unit] ?? 1));
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
  const id = rawId.slice(0, 12);
  const labels = labelsOf(o.Labels);
  const service = labels['com.docker.compose.service'] || '';
  const stateRaw = str(o, 'State') || str(o, 'Status');
  const ports = parsePorts(o.Ports);
  return {
    id,
    rt,
    name: firstName(o.Names) || str(o, 'Names') || id,
    image: str(o, 'Image'),
    status: mapState(stateRaw),
    cpu: 0,
    mem: 0,
    port: ports.length ? ports.map((p) => `${p.host}:${p.container}`).join(', ') : '—',
    ports,
    networks: list(o.Networks),
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
  const sizeBytes =
    typeof o.Size === 'number' ? o.Size : sizeToBytes(str(o, 'Size'));
  return {
    id: str(o, 'ID', 'Id').replace(/^sha256:/, '').slice(0, 12),
    rt,
    name: name || '<none>',
    tag: tag || 'latest',
    size: sizeBytes ? formatBytes(sizeBytes) : str(o, 'Size') || '—',
    sizeBytes,
    built: str(o, 'CreatedSince', 'CreatedAt') || relAge(o.Created) || '—',
  };
}

export function parseVolume(rt: RuntimeName, o: Raw): Volume {
  return {
    name: str(o, 'Name'),
    rt,
    size: '—',
    sizeBytes: 0,
    mount: str(o, 'Mountpoint'),
    driver: str(o, 'Driver') || 'local',
    attachedTo: [],
    created: str(o, 'CreatedAt') || '—',
  };
}

export function parseNetwork(rt: RuntimeName, o: Raw): Network {
  // Podman lists subnets as objects; Docker's `network ls` has no subnet.
  let subnet = str(o, 'Subnet');
  let gateway = str(o, 'Gateway');
  if (Array.isArray(o.subnets) && o.subnets[0] && typeof o.subnets[0] === 'object') {
    const s = o.subnets[0] as Raw;
    subnet = str(s, 'subnet') || subnet;
    gateway = str(s, 'gateway') || gateway;
  }
  return {
    name: str(o, 'Name', 'name'),
    rt,
    driver: str(o, 'Driver', 'driver') || 'bridge',
    scope: str(o, 'Scope') || 'local',
    subnet: subnet || '—',
    gateway: gateway || '—',
    attached: 0,
    internal: o.Internal === true || o.internal === true || str(o, 'Internal') === 'true',
  };
}

/** Convert a CLI memory string ("24.3MiB / 7.65GiB") to megabytes. */
function memToMB(s: string): number {
  const first = s.split('/')[0].trim();
  return sizeToBytes(first) / (1024 * 1024);
}

/** "1.2kB / 3.4MB" → [received, sent] in bytes. */
function ioPair(s: string): [number, number] {
  const [a, b] = s.split('/').map((x) => sizeToBytes(x.trim()));
  return [a || 0, b || 0];
}

export interface ContainerStat {
  id: string;
  name: string;
  cpu: number;
  mem: number;
  netIn: number;
  netOut: number;
}

/** Normalise one `docker/podman stats` row. */
export function parseStat(o: Raw): ContainerStat {
  const [netIn, netOut] = ioPair(str(o, 'NetIO', 'net_io'));
  return {
    id: str(o, 'ID', 'Id', 'id', 'Container', 'ContainerID').slice(0, 12),
    name: str(o, 'Name', 'name'),
    cpu: parseFloat(str(o, 'CPUPerc', 'cpu_percent', 'CPU')) || 0,
    mem: Math.round(memToMB(str(o, 'MemUsage', 'mem_usage', 'MemoryUsage'))),
    netIn,
    netOut,
  };
}
