import type { DownloadLinkMeta } from "../types";
import type { StreamTarget } from "./streamTarget";

export type { DownloadLinkMeta };

export function downloadLinkMetaFromTarget(
  target: StreamTarget,
  season?: number,
  episode?: number
): DownloadLinkMeta {
  const activeSeason = season ?? target.season;
  const activeEpisode = episode ?? target.episode;

  if (target.mediaType === "series" && activeSeason != null && activeEpisode != null) {
    return {
      tmdb_id: target.tmdb_id,
      media_type: "series",
      season: activeSeason,
      episode: activeEpisode,
      watchlist_item_id: target.watchlistItemId,
    };
  }

  if (target.mediaType === "series") {
    return {
      tmdb_id: target.tmdb_id,
      media_type: "series",
      watchlist_item_id: target.watchlistItemId,
    };
  }

  return {
    tmdb_id: target.tmdb_id,
    media_type: "movie",
    watchlist_item_id: target.watchlistItemId,
  };
}

export function downloadLinkMetaFromSearch(
  tmdbId: number,
  type: "movie" | "series",
  season?: number,
  episode?: number
): DownloadLinkMeta {
  if (type === "series" && season != null && episode != null) {
    return { tmdb_id: tmdbId, media_type: "series", season, episode };
  }
  if (type === "series") {
    return { tmdb_id: tmdbId, media_type: "series" };
  }
  return { tmdb_id: tmdbId, media_type: "movie" };
}

export function downloadLinkMetaFromAnime(
  selected: {
    stremio_id?: string;
    title: string;
    type: "movie" | "series";
  },
  season?: number,
  episode?: number
): DownloadLinkMeta | undefined {
  const sid = (selected.stremio_id || "").trim();
  if (!sid) return undefined;
  if (selected.type === "series" && season != null && episode != null) {
    return {
      stremio_id: sid,
      series_title: selected.title,
      media_type: "series",
      season,
      episode,
    };
  }
  if (selected.type === "series") {
    return { stremio_id: sid, series_title: selected.title, media_type: "series" };
  }
  return { stremio_id: sid, series_title: selected.title, media_type: "movie" };
}

export function watchlistPayloadFromTarget(
  target: StreamTarget,
  season?: number,
  episode?: number
) {
  const activeSeason = season ?? target.season;
  const activeEpisode = episode ?? target.episode;

  if (target.mediaType === "series" && activeSeason != null && activeEpisode != null) {
    return {
      kind: "episode" as const,
      tmdb_id: target.tmdb_id,
      media_type: "series" as const,
      season: activeSeason,
      episode: activeEpisode,
      title: target.title,
      poster: target.poster ?? "",
      year: target.year ?? "",
      overview: target.overview,
    };
  }
  if (target.mediaType === "series") {
    return {
      kind: "series" as const,
      tmdb_id: target.tmdb_id,
      media_type: "series" as const,
      title: target.title,
      poster: target.poster ?? "",
      year: target.year ?? "",
      overview: target.overview,
    };
  }
  return {
    kind: "movie" as const,
    tmdb_id: target.tmdb_id,
    media_type: "movie" as const,
    title: target.title,
    poster: target.poster ?? "",
    year: target.year ?? "",
    overview: target.overview,
  };
}
