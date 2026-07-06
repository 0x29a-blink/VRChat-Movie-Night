import type { LibraryItem } from "./types";

export const LIBRARY_SORT_OPTIONS = [
  { value: "recent", label: "Recently added" },
  { value: "title", label: "Title A-Z" },
  { value: "duration", label: "Duration" },
  { value: "size", label: "Size" },
] as const;

export type LibrarySort = (typeof LIBRARY_SORT_OPTIONS)[number]["value"];

export const LIBRARY_FILTER_OPTIONS = [
  { value: "all", label: "All videos" },
  { value: "needs_link", label: "Needs linking" },
  { value: "not_on_watchlist", label: "Not on watchlist" },
] as const;

export type LibraryFilter = (typeof LIBRARY_FILTER_OPTIONS)[number]["value"];

/** TMDB linking is only meaningful for movie/show files; YouTube and M3U8
 * items are unlinked by nature and should not be flagged as needing work. */
export function linkApplies(item: LibraryItem): boolean {
  return item.folder === "torrents";
}

function matchesFilter(item: LibraryItem, filter: LibraryFilter): boolean {
  if (filter === "needs_link") return linkApplies(item) && !item.linked;
  if (filter === "not_on_watchlist") return !!item.linked && item.on_watchlist === false;
  return true;
}

function titleFor(item: LibraryItem): string {
  return item.display_title || item.title;
}

function matchesQuery(item: LibraryItem, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = `${titleFor(item)} ${item.filename}`.toLowerCase();
  return haystack.includes(q);
}

function sortItems(items: LibraryItem[], sort: LibrarySort): LibraryItem[] {
  const out = items.slice();
  out.sort((a, b) => {
    if (sort === "title") return titleFor(a).localeCompare(titleFor(b));
    if (sort === "duration") return b.duration - a.duration;
    if (sort === "size") return b.size - a.size;
    return b.id - a.id;
  });
  return out;
}

/**
 * Filters items by title/filename (case-insensitive substring) and state
 * filter (needs linking / not on watchlist), then sorts. Pure — used
 * per-folder-section by Library.tsx so grouping is preserved by the caller
 * (this only filters/sorts within a single section's items).
 */
export function filterAndSortLibrary(
  items: LibraryItem[],
  query: string,
  sort: LibrarySort,
  filter: LibraryFilter = "all"
): LibraryItem[] {
  return sortItems(
    items.filter((item) => matchesQuery(item, query) && matchesFilter(item, filter)),
    sort
  );
}
