// Runtime-filtered entity counts for the tab badges and dashboard stat tiles.
// Live under Tauri, seed in the browser — derived in exactly one place.

import { useAppStore } from '@/store/appStore';
import { useBuilds, useImages, useNetworks, useVolumes } from './useData';

export interface Counts {
  running: number;
  paused: number;
  stopped: number;
  total: number;
  images: number;
  volumes: number;
  networks: number;
  builds: number;
}

export function useCounts(): Counts {
  const containers = useAppStore((s) => s.containers);
  const runtimeFilter = useAppStore((s) => s.runtimeFilter);

  const fc =
    runtimeFilter === 'all'
      ? containers
      : containers.filter((c) => c.rt === runtimeFilter);

  const images = useImages(runtimeFilter).data;
  const volumes = useVolumes(runtimeFilter).data;
  const networks = useNetworks(runtimeFilter).data;
  const builds = useBuilds(runtimeFilter).data;

  return {
    running: fc.filter((c) => c.status === 'running').length,
    paused: fc.filter((c) => c.status === 'paused').length,
    stopped: fc.filter((c) => c.status === 'stopped').length,
    total: fc.length,
    images: images.length,
    volumes: volumes.length,
    networks: networks.length,
    builds: builds.length,
  };
}
