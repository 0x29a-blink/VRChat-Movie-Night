/**
 * Tiny module-level stale-while-revalidate cache for tab data (watchlist,
 * stats). Consumers seed their state from the cache so a revisited tab
 * paints instantly, then refetch in the background and reconcile. Values
 * live for the browser session only — WS-driven refetches and the
 * revalidate-on-mount pattern keep staleness windows short.
 */
const cache = new Map<string, unknown>();

export function readCache<T>(key: string): T | undefined {
  return cache.get(key) as T | undefined;
}

export function writeCache<T>(key: string, value: T): void {
  cache.set(key, value);
}

export function clearCacheForTests(): void {
  cache.clear();
}
