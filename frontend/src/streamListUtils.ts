import type { StreamFilterState } from "./streamFilters";
import type { StreamResult } from "./types";

export const RES_OPTIONS = ["2160p", "1080p", "720p", "480p"] as const;

const RES_RANK: Record<string, number> = { "2160p": 5, "1080p": 3, "720p": 2, "480p": 1 };

export function streamKey(s: StreamResult): string {
  return s.url || s.magnet || s.info_hash || "";
}

export function filterAndSortStreams(streams: StreamResult[], filters: StreamFilterState): StreamResult[] {
  let out = streams.slice();
  if (filters.minRes) {
    out = out.filter((s) => (s.resolution_rank || 0) >= (RES_RANK[filters.minRes] || 0));
  }
  if (filters.codec) out = out.filter((s) => s.codec === filters.codec);
  if (filters.maxSize) {
    out = out.filter((s) => s.size_gb > 0 && s.size_gb <= Number(filters.maxSize));
  }
  if (filters.cachedOnly) out = out.filter((s) => s.cached);
  if (filters.minSeeders) {
    const min = Number(filters.minSeeders);
    if (min > 0) out = out.filter((s) => s.cached || s.seeders >= min);
  }
  out.sort((a, b) => {
    if (filters.sortBy === "size") return b.size_gb - a.size_gb;
    if (filters.sortBy === "seeders") return b.seeders - a.seeders;
    return b.resolution_rank - a.resolution_rank || Number(b.cached) - Number(a.cached);
  });
  return out;
}
