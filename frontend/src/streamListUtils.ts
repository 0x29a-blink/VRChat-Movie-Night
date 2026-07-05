import type { StreamFilterState } from "./streamFilters";
import type { StreamResult } from "./types";

export const RES_OPTIONS = ["2160p", "1080p", "720p", "480p"] as const;

const RES_RANK: Record<string, number> = { "2160p": 5, "1080p": 3, "720p": 2, "480p": 1 };

function langMatches(languages: string[], pattern: RegExp): boolean {
  return (languages || []).some((l) => pattern.test(l.trim()));
}

const HAS_ENGLISH = /english|\beng\b/i;
const HAS_JAPANESE = /japanese|\bjpn\b|\bja\b/i;

export function streamKey(s: StreamResult): string {
  return s.url || s.magnet || s.info_hash || "";
}

function streamSearchHaystack(s: StreamResult): string {
  return [
    s.name,
    s.filename,
    s.description,
    s.provider,
    s.source,
    s.resolution,
    s.codec,
    s.hdr,
    ...(s.languages || []),
    ...(s.subtitle_langs || []),
    ...(s.lang_tags || []),
    ...(s.audio_tags || []),
    ...(s.visual_tags || []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function streamMatchesSearch(s: StreamResult, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = streamSearchHaystack(s);
  return q.split(/\s+/).every((term) => hay.includes(term));
}

export function filterAndSortStreams(streams: StreamResult[], filters: StreamFilterState): StreamResult[] {
  let out = streams.slice();
  if (filters.searchText.trim()) {
    out = out.filter((s) => streamMatchesSearch(s, filters.searchText));
  }
  if (filters.minRes) {
    out = out.filter((s) => (s.resolution_rank || 0) >= (RES_RANK[filters.minRes] || 0));
  }
  if (filters.codec) out = out.filter((s) => s.codec === filters.codec);
  if (filters.maxSize) {
    out = out.filter((s) => s.size_gb > 0 && s.size_gb <= Number(filters.maxSize));
  }
  if (filters.cachedOnly) out = out.filter((s) => s.cached);
  if (filters.indexer) {
    const want = filters.indexer.toLowerCase();
    out = out.filter((s) => (s.indexer || "").toLowerCase() === want);
  }
  if (filters.releaseGroup) {
    const want = filters.releaseGroup.toLowerCase();
    out = out.filter((s) => (s.release_group || "").toLowerCase() === want);
  }
  if (filters.minSeeders) {
    const min = Number(filters.minSeeders);
    if (min > 0) out = out.filter((s) => s.cached || s.seeders >= min);
  }
  if (filters.audioLang === "dub") {
    out = out.filter(
      (s) =>
        s.audio_lang === "dub" ||
        s.audio_lang === "dual" ||
        langMatches(s.languages, HAS_ENGLISH)
    );
  } else if (filters.audioLang === "sub") {
    out = out.filter(
      (s) =>
        s.audio_lang === "sub" ||
        (langMatches(s.languages, HAS_JAPANESE) && !langMatches(s.languages, HAS_ENGLISH))
    );
  } else if (filters.audioLang === "dual") {
    out = out.filter(
      (s) =>
        s.audio_lang === "dual" ||
        (langMatches(s.languages, HAS_ENGLISH) && langMatches(s.languages, HAS_JAPANESE))
    );
  }
  if (filters.subtitleType === "softsub") {
    out = out.filter(
      (s) => s.subtitle_type === "softsub" || (s.subtitle_langs && s.subtitle_langs.length > 0)
    );
  } else if (filters.subtitleType === "hardsub") {
    out = out.filter((s) => s.subtitle_type === "hardsub");
  }

  out.sort((a, b) => {
    if (filters.sortBy === "size") return b.size_gb - a.size_gb;
    if (filters.sortBy === "seeders") return b.seeders - a.seeders;
    const dubBoost = filters.preferDub ? 1 : 0;
    if (dubBoost) {
      const langDiff = (b.audio_lang_rank || 0) - (a.audio_lang_rank || 0);
      if (langDiff !== 0) return langDiff;
    }
    return (
      b.resolution_rank - a.resolution_rank ||
      Number(b.cached) - Number(a.cached) ||
      b.seeders - a.seeders
    );
  });
  return out;
}
