import type { LibraryItem } from "../types";
import type { WatchlistAddPayload } from "./AddToWatchlist";

export function watchlistPayloadFromLibraryItem(item: LibraryItem): WatchlistAddPayload {
  if (item.tmdb_id && item.media_type) {
    if (item.media_type === "series" && item.season != null && item.episode != null) {
      return {
        kind: "episode",
        tmdb_id: item.tmdb_id,
        media_type: "series",
        season: item.season,
        episode: item.episode,
        title: item.display_title || item.title,
        poster: item.poster || item.thumbnail,
        year: item.tmdb_year,
        library_item_id: item.id,
      };
    }
    if (item.media_type === "series") {
      return {
        kind: "series",
        tmdb_id: item.tmdb_id,
        media_type: "series",
        title: item.tmdb_title || item.title,
        poster: item.poster || item.thumbnail,
        year: item.tmdb_year,
        library_item_id: item.id,
      };
    }
    return {
      kind: "movie",
      tmdb_id: item.tmdb_id,
      media_type: "movie",
      title: item.tmdb_title || item.title,
      poster: item.poster || item.thumbnail,
      year: item.tmdb_year,
      library_item_id: item.id,
    };
  }
  return {
    kind: "movie",
    title: item.title,
    poster: item.poster || item.thumbnail,
    library_item_id: item.id,
  };
}

export function libraryLinkLabel(item: LibraryItem): string | null {
  if (!item.linked || !item.tmdb_id) return null;
  if (item.media_type === "series" && item.season != null && item.episode != null) {
    return `S${String(item.season).padStart(2, "0")}E${String(item.episode).padStart(2, "0")}`;
  }
  if (item.media_type === "series") return "Series";
  return "Movie";
}
