// Generic data hook: fetch once, re-fetch when deps change, optional polling.
// Every page gets the same { data, loading, error, refetch } shape.

import { useCallback, useEffect, useState } from 'react';

export const REFRESH_EVENT = 'dockman:refresh';

/** Ask every mounted resource hook to fetch again. */
export function refreshAll(): void {
  window.dispatchEvent(new Event(REFRESH_EVENT));
}

export interface Resource<T> {
  data: T;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

/**
 * @param fetcher  data source
 * @param initial  value shown until the first fetch resolves
 * @param deps     re-fetch when these change
 * @param pollMs   optional polling interval
 */
export function useResource<T>(
  fetcher: () => Promise<T>,
  initial: T,
  deps: unknown[] = [],
  pollMs = 0,
): Resource<T> {
  const [data, setData] = useState<T>(initial);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const load = useCallback(() => {
    fetcher()
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, deps);

  useEffect(() => {
    setLoading(true);
    load();
    // The top bar's refresh button re-fetches every mounted resource.
    window.addEventListener(REFRESH_EVENT, load);
    const id = pollMs > 0 ? setInterval(load, pollMs) : 0;
    return () => {
      window.removeEventListener(REFRESH_EVENT, load);
      if (id) clearInterval(id);
    };
  }, [load, pollMs]);

  return { data, loading, error, refetch: load };
}
