// Host resource meters for the command bar and the Overview health strip.
//
// CPU and memory are derived from the container inventory (the same source the
// table renders), so the meters always agree with the rows below them. Total
// cores, total RAM and disk usage have no command behind them yet — they come
// from HOST until `commands.ts` grows a `host_resources` call, matching the
// figures the Dashboard has always shown.

import { useMemo } from 'react';
import { useAppStore } from '@/store/appStore';

/** Static host facts, pending a real backend command. */
export const HOST = {
  cores: 12,
  memTotalGb: 16,
  diskUsedGb: 24.3,
  diskFreeGb: 178,
};

export interface HostResources {
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

  return useMemo(() => {
    const fc =
      runtimeFilter === 'all'
        ? containers
        : containers.filter((c) => c.rt === runtimeFilter);

    const cpuPercent = Math.min(
      100,
      fc.reduce((sum, c) => sum + c.cpu, 0),
    );
    const memUsedGb = fc.reduce((sum, c) => sum + c.mem, 0) / 1024;
    const diskTotal = HOST.diskUsedGb + HOST.diskFreeGb;

    return {
      cpuPercent,
      coresBusy: Math.round((cpuPercent / 100) * HOST.cores),
      memUsedGb,
      memPercent: Math.min(100, (memUsedGb / HOST.memTotalGb) * 100),
      diskUsedGb: HOST.diskUsedGb,
      diskFreeGb: HOST.diskFreeGb,
      diskPercent: (HOST.diskUsedGb / diskTotal) * 100,
    };
  }, [containers, runtimeFilter]);
}
