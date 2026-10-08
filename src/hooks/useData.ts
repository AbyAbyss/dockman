// Per-domain data hooks. Each returns runtime-filtered data read from the
// Docker / Podman CLIs.

import { useMemo } from 'react';
import { useResource, type Resource } from './useResource';
import {
  BuildCommands,
  HostCommands,
  ImageCommands,
  NetworkCommands,
  RuntimeCommands,
  VolumeCommands,
  runtimesFor,
  type ContainerDetail,
  type DfRow,
  type EngineInfo,
  type HostInfo,
  type RuntimeInfo,
  type VolumeUsage,
} from '@/lib/commands';
import { RUNTIME_BRAND, emptyRuntimeMeta } from '@/data/runtimes';
import type {
  BuildRecord,
  ImageItem,
  Network,
  RuntimeFilter,
  RuntimeMeta,
  RuntimeName,
  Volume,
} from '@/types';

const NONE: never[] = [];

export function useImages(filter: RuntimeFilter): Resource<ImageItem[]> {
  return useResource(() => ImageCommands.list(filter), NONE as ImageItem[], [filter]);
}

export function useVolumes(filter: RuntimeFilter): Resource<Volume[]> {
  return useResource(() => VolumeCommands.list(filter), NONE as Volume[], [filter]);
}

export function useNetworks(filter: RuntimeFilter): Resource<Network[]> {
  return useResource(() => NetworkCommands.list(filter), NONE as Network[], [filter]);
}

export function useBuilds(filter: RuntimeFilter): Resource<BuildRecord[]> {
  const res = useResource(() => BuildCommands.list(), NONE as BuildRecord[], []);
  const data = useMemo(
    () => (filter === 'all' ? res.data : res.data.filter((b) => b.rt === filter)),
    [res.data, filter],
  );
  return { ...res, data };
}

/** Mounts and network addresses for every container on the active runtimes. */
export function useContainerDetails(
  filter: RuntimeFilter,
  pollMs = 0,
): Resource<ContainerDetail[]> {
  return useResource(
    () => HostCommands.containerDetails(filter),
    NONE as ContainerDetail[],
    [filter],
    pollMs,
  );
}

/** `system df` rows per runtime on the active filter. */
export function useSystemDf(
  filter: RuntimeFilter,
  pollMs = 0,
): Resource<(DfRow & { rt: RuntimeName })[]> {
  return useResource(
    async () => {
      const lists = await Promise.all(
        runtimesFor(filter).map(async (rt) => {
          try {
            return (await HostCommands.systemDf(rt)).map((r) => ({ ...r, rt }));
          } catch {
            return [];
          }
        }),
      );
      return lists.flat();
    },
    NONE as (DfRow & { rt: RuntimeName })[],
    [filter],
    pollMs,
  );
}

export function useVolumeUsage(
  filter: RuntimeFilter,
): Resource<(VolumeUsage & { rt: RuntimeName })[]> {
  return useResource(
    async () => {
      const lists = await Promise.all(
        runtimesFor(filter).map(async (rt) => {
          try {
            return (await HostCommands.volumeUsage(rt)).map((r) => ({ ...r, rt }));
          } catch {
            return [];
          }
        }),
      );
      return lists.flat();
    },
    NONE as (VolumeUsage & { rt: RuntimeName })[],
    [filter],
  );
}

/** `info` for each runtime on the active filter; unreachable engines are skipped. */
export function useEngineInfo(filter: RuntimeFilter, pollMs = 0): Resource<EngineInfo[]> {
  return useResource(
    async () => {
      const list = await Promise.all(
        runtimesFor(filter).map((rt) => HostCommands.engineInfo(rt).catch(() => null)),
      );
      return list.filter((x): x is EngineInfo => x !== null);
    },
    NONE as EngineInfo[],
    [filter],
    pollMs,
  );
}

export function useHostInfo(): Resource<HostInfo | null> {
  return useResource(() => HostCommands.info(), null, []);
}

/** Runtime metadata — live detection overlaid on the brand colours. */
export function useRuntimes(pollMs = 0): {
  runtimes: Record<RuntimeName, RuntimeMeta>;
  loading: boolean;
  refetch: () => void;
} {
  const res = useResource<RuntimeInfo[]>(
    () => RuntimeCommands.detectAll(),
    NONE as RuntimeInfo[],
    [],
    pollMs,
  );
  const runtimes = useMemo(() => {
    const merged: Record<RuntimeName, RuntimeMeta> = {
      docker: emptyRuntimeMeta('docker'),
      podman: emptyRuntimeMeta('podman'),
    };
    for (const info of res.data) {
      const brand = RUNTIME_BRAND[info.runtime];
      if (!brand) continue;
      merged[info.runtime] = {
        ...brand,
        found: info.found,
        version: info.version,
        path: info.path,
        arch: info.arch,
        running: info.isRunning,
      };
    }
    return merged;
  }, [res.data]);
  return { runtimes, loading: res.loading, refetch: res.refetch };
}
