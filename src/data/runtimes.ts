// Static facts about the two runtimes: display names and brand colours.
// Everything else on a RuntimeMeta (version, path, whether it is installed
// or running) comes from live detection.

import type { RuntimeMeta, RuntimeName } from '@/types';

export const RUNTIME_BRAND: Record<
  RuntimeName,
  { name: string; short: string; accent: string; soft: string }
> = {
  docker: {
    name: 'Docker',
    short: 'docker',
    accent: '#2496ed',
    soft: 'rgba(36,150,237,0.18)',
  },
  podman: {
    name: 'Podman',
    short: 'podman',
    accent: '#892ca0',
    soft: 'rgba(137,44,160,0.20)',
  },
};

export const RUNTIME_NAMES: RuntimeName[] = ['docker', 'podman'];

/** A runtime that detection has not reported on yet. */
export function emptyRuntimeMeta(rt: RuntimeName): RuntimeMeta {
  return {
    ...RUNTIME_BRAND[rt],
    found: false,
    version: '',
    path: '',
    arch: '',
    running: false,
  };
}
