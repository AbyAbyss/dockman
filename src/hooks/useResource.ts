// Generic data hook: live fetch under Tauri, static seed in the browser.
// Keeps every page agnostic about which mode it is running in.

import { useCallback, useEffect, useState } from 'react';
import { isTauri } from '@/lib/tauri';

export interface Resource<T> {
  data: T;
  loading: boolean;
  error: string | null;
  live: boolean;
  refetch: () => void;
}

/**
 * @param fetcher  live data source (only called under Tauri)
 * @param seed     fallback value used in the browser
 * @param deps     re-fetch when these change
 * @param pollMs   optional polling interval (live mode only)
 */
export function useResource<T>(
  fetcher: () => Promise<T>,
  seed: T,
  deps: unknown[] = [],
  pollMs = 0,
): Resource<T> {
  const live = isTauri();
  const [data, setData] = useState<T>(seed);
  const [loading, setLoading] = useState<boolean>(live);
  const [error, setError] = useState<string | null>(null);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const load = useCallback(() => {
    if (!live) return;
    fetcher()
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, deps);

  useEffect(() => {
    if (!live) return;
    setLoading(true);
    load();
    if (pollMs > 0) {
      const id = setInterval(load, pollMs);
      return () => clearInterval(id);
    }
  }, [load, live, pollMs]);

  return { data: live ? data : seed, loading, error, live, refetch: load };
}
