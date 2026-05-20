// Per-domain data hooks. Each returns runtime-filtered data — live from the
// CLIs under Tauri, from the typed seed in the browser.

import { useMemo } from 'react';
import { useResource, type Resource } from './useResource';
import {
  BuildCommands,
  ImageCommands,
  NetworkCommands,
  RuntimeCommands,
  VolumeCommands,
  type RuntimeInfo,
} from '@/lib/commands';
import {
  INITIAL_BUILDS,
  INITIAL_IMAGES,
  INITIAL_NETWORKS,
  INITIAL_VOLUMES,
  RUNTIMES,
} from '@/data/seed';
import type {
  BuildRecord,
  ImageItem,
  Network,
  RuntimeFilter,
  RuntimeMeta,
  RuntimeName,
  Volume,
} from '@/types';

const NO_RUNTIMES: RuntimeInfo[] = [];

function byRuntime<T extends { rt: RuntimeName }>(
  arr: T[],
  filter: RuntimeFilter,
): T[] {
  return filter === 'all' ? arr : arr.filter((x) => x.rt === filter);
}

export function useImages(filter: RuntimeFilter): Resource<ImageItem[]> {
  const seed = useMemo(() => byRuntime(INITIAL_IMAGES, filter), [filter]);
  return useResource(() => ImageCommands.list(filter), seed, [filter]);
}

export function useVolumes(filter: RuntimeFilter): Resource<Volume[]> {
  const seed = useMemo(() => byRuntime(INITIAL_VOLUMES, filter), [filter]);
  return useResource(() => VolumeCommands.list(filter), seed, [filter]);
}

export function useNetworks(filter: RuntimeFilter): Resource<Network[]> {
  const seed = useMemo(() => byRuntime(INITIAL_NETWORKS, filter), [filter]);
  return useResource(() => NetworkCommands.list(filter), seed, [filter]);
}

export function useBuilds(filter: RuntimeFilter): Resource<BuildRecord[]> {
  const seed = useMemo(() => byRuntime(INITIAL_BUILDS, filter), [filter]);
  return useResource(() => BuildCommands.list(), seed, [filter]);
}

/** Runtime metadata — live detection overlaid on the seed brand colors. */
export function useRuntimes(): {
  runtimes: Record<RuntimeName, RuntimeMeta>;
  live: boolean;
  refetch: () => void;
} {
  const res = useResource<RuntimeInfo[]>(
    () => RuntimeCommands.detectAll(),
    NO_RUNTIMES,
    [],
  );
  const runtimes = useMemo(() => {
    if (!res.live || res.data.length === 0) return RUNTIMES;
    const merged: Record<RuntimeName, RuntimeMeta> = { ...RUNTIMES };
    for (const info of res.data) {
      const base = RUNTIMES[info.runtime];
      if (!base) continue;
      merged[info.runtime] = {
        ...base,
        found: info.found,
        version: info.version || base.version,
        path: info.path || base.path,
        arch: info.arch || base.arch,
        running: info.isRunning,
      };
    }
    return merged;
  }, [res.live, res.data]);
  return { runtimes, live: res.live, refetch: res.refetch };
}
