import type { TmdbEpisode } from "../types";
import type { WatchlistAddPayload } from "./AddToWatchlist";

export function watchlistPayloadFromSearch(
  selected: {
    tmdb_id: number;
    type: "movie" | "series";
    title: string;
    poster: string;
    year: string;
    overview?: string;
    stremio_id?: string;
    anime_native?: boolean;
  },
  season?: number,
  episode?: number,
  episodeRow?: Pick<TmdbEpisode, "episode_number" | "name" | "overview" | "air_date" | "still">
): WatchlistAddPayload {
  const seriesTitle = selected.title;
  const stremio = (selected.stremio_id || "").trim();

  if (selected.type === "series" && season != null && episode != null) {
    return {
      kind: "episode",
      tmdb_id: selected.tmdb_id > 0 ? selected.tmdb_id : undefined,
      stremio_id: stremio || undefined,
      series_title: seriesTitle,
      media_type: "series",
      season,
      episode,
      title: episodeRow
        ? `${episodeRow.episode_number}. ${episodeRow.name}`
        : `S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}`,
      poster: episodeRow?.still || selected.poster,
      year: selected.year,
      overview: episodeRow?.overview || "",
      air_date: episodeRow?.air_date || "",
    };
  }
  if (selected.type === "series") {
    return {
      kind: "series",
      tmdb_id: selected.tmdb_id > 0 ? selected.tmdb_id : undefined,
      stremio_id: stremio || undefined,
      series_title: seriesTitle,
      media_type: "series",
      title: seriesTitle,
      poster: selected.poster,
      year: selected.year,
      overview: selected.overview,
    };
  }
  return {
    kind: "movie",
    tmdb_id: selected.tmdb_id,
    media_type: "movie",
    title: seriesTitle,
    poster: selected.poster,
    year: selected.year,
    overview: selected.overview,
  };
}
