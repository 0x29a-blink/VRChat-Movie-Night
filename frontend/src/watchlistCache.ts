import { api } from "./api";
import { readCache, writeCache } from "./swrCache";

export type WatchlistGroupsResponse = Awaited<ReturnType<typeof api.watchlistGroups>>;
export type WatchlistItemsResponse = Awaited<ReturnType<typeof api.watchlistGroupItems>>;

export const WATCHLIST_GROUPS_KEY = "watchlist:groups";

export function watchlistItemsKey(groupId: number, section: string): string {
  return `watchlist:items:${groupId}:${section}`;
}

/**
 * The one fetch+cache pairing for watchlist groups — every consumer
 * (Watchlist, Stats, prefetch) goes through here so the SWR seed can never
 * silently go stale because a call site forgot the writeCache half.
 */
export async function fetchWatchlistGroups(): Promise<WatchlistGroupsResponse> {
  const r = await api.watchlistGroups();
  writeCache(WATCHLIST_GROUPS_KEY, r);
  return r;
}

/**
 * Warm the watchlist caches (groups + the default ungrouped to-watch list)
 * while the app is idle, so the first visit to the tab paints instantly
 * instead of starting from a cold fetch. Best-effort — failures are ignored
 * and the tab falls back to its normal cold load.
 */
export async function prefetchWatchlist(): Promise<void> {
  try {
    if (!readCache(WATCHLIST_GROUPS_KEY)) {
      await fetchWatchlistGroups();
    }
    const itemsKey = watchlistItemsKey(0, "to_watch");
    if (!readCache(itemsKey)) {
      writeCache(itemsKey, await api.watchlistGroupItems(0, "to_watch"));
    }
  } catch {
    // Prefetch is opportunistic; the tab handles its own errors on demand.
  }
}
