import type { LibraryItem, WatchlistItem } from "../types";

export type StreamTarget = {
  title: string;
  poster?: string;
  year?: string;
  overview?: string;
  tmdb_id: number;
  mediaType: "movie" | "series";
  season?: number;
  episode?: number;
  watchlistItemId?: number;
  libraryMatch?: LibraryItem | null;
};

export function streamTargetFromWatchlistItem(item: WatchlistItem): StreamTarget | null {
  if (item.kind === "collection") return null;
  if (!item.tmdb_id) return null;

  if (item.kind === "episode") {
    if (item.season == null || item.episode == null) return null;
    return {
      title: item.title,
      poster: item.poster,
      year: item.year,
      overview: item.overview,
      tmdb_id: item.tmdb_id,
      mediaType: "series",
      season: item.season,
      episode: item.episode,
      watchlistItemId: item.id,
      libraryMatch: item.library_match ?? null,
    };
  }

  const mediaType = item.kind === "series" ? "series" : "movie";
  return {
    title: item.title,
    poster: item.poster,
    year: item.year,
    overview: item.overview,
    tmdb_id: item.tmdb_id,
    mediaType,
    watchlistItemId: item.id,
    libraryMatch: item.library_match ?? null,
  };
}

export function streamTargetFromPartial(item: {
  title?: string;
  poster?: string;
  year?: string;
  overview?: string;
  tmdb_id?: number | null;
  kind?: string;
  media_type?: string;
  season?: number | null;
  episode?: number | null;
  library_match?: LibraryItem | null;
}): StreamTarget | null {
  if (!item.tmdb_id) return null;
  const kind = item.kind || item.media_type || "movie";
  if (kind === "episode") {
    if (item.season == null || item.episode == null) return null;
    return {
      title: item.title || "Episode",
      poster: item.poster,
      year: item.year,
      overview: item.overview,
      tmdb_id: item.tmdb_id,
      mediaType: "series",
      season: item.season,
      episode: item.episode,
      libraryMatch: item.library_match ?? null,
    };
  }
  const mediaType = kind === "series" ? "series" : "movie";
  return {
    title: item.title || "Title",
    poster: item.poster,
    year: item.year,
    overview: item.overview,
    tmdb_id: item.tmdb_id,
    mediaType,
    libraryMatch: item.library_match ?? null,
  };
}
