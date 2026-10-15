// Host resource meters for the command bar and the Overview health strip.
//
// CPU and memory are derived from the container inventory (the same source the
// table renders), so the meters always agree with the rows below them. Total
// cores, total RAM and disk usage come from the `host_info` command under
// Tauri, and from HOST in the browser.

import { useMemo } from 'react';
import { useAppStore } from '@/store/appStore';
import { useResource } from './useResource';
import { SystemCommands, type HostInfo } from '@/lib/commands';

const GB = 1024 ** 3;

/** Static host facts for the browser preview. */
export const HOST = {
  cores: 12,
  memTotalGb: 16,
  diskUsedGb: 24.3,
  diskFreeGb: 178,
};

export interface HostResources {
  cores: number;
  memTotalGb: number;
  cpuPercent: number;
  coresBusy: number;
  memUsedGb: number;
  memPercent: number;
  diskUsedGb: number;
  diskFreeGb: number;
  diskPercent: number;
}

export function useHostResources(): HostResources {
  const containers = useAppStore((s) => s.containers);
  const runtimeFilter = useAppStore((s) => s.runtimeFilter);
  const info = useResource<HostInfo | null>(SystemCommands.hostInfo, null);

  return useMemo(() => {
    // Live mode reports 0 for anything not yet (or not) detected.
    const host = !info.live
      ? HOST
      : {
          cores: info.data?.cores ?? 0,
          memTotalGb: (info.data?.memTotalBytes ?? 0) / GB,
          diskUsedGb:
            ((info.data?.diskTotalBytes ?? 0) - (info.data?.diskFreeBytes ?? 0)) / GB,
          diskFreeGb: (info.data?.diskFreeBytes ?? 0) / GB,
        };

    const fc =
      runtimeFilter === 'all'
        ? containers
        : containers.filter((c) => c.rt === runtimeFilter);

    const cpuPercent = Math.min(
      100,
      fc.reduce((sum, c) => sum + c.cpu, 0),
    );
    const memUsedGb = fc.reduce((sum, c) => sum + c.mem, 0) / 1024;
    const diskTotal = host.diskUsedGb + host.diskFreeGb;

    return {
      cores: host.cores,
      memTotalGb: host.memTotalGb,
      cpuPercent,
      coresBusy: Math.round((cpuPercent / 100) * host.cores),
      memUsedGb,
      memPercent: host.memTotalGb
        ? Math.min(100, (memUsedGb / host.memTotalGb) * 100)
        : 0,
      diskUsedGb: host.diskUsedGb,
      diskFreeGb: host.diskFreeGb,
      diskPercent: diskTotal ? (host.diskUsedGb / diskTotal) * 100 : 0,
    };
  }, [containers, runtimeFilter, info.live, info.data]);
}
