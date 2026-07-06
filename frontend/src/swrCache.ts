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

/** Drops every cached entry — called on logout so the next user never sees
 * the previous user's data, and by tests. */
export function clearCache(): void {
  cache.clear();
}
