import type { LibraryItem } from "../types";
import type { WatchlistAddPayload } from "./AddToWatchlist";

function seriesTitleFromLibrary(item: LibraryItem): string {
  if (item.tmdb_title) return item.tmdb_title;
  const raw = item.display_title || item.title || item.filename;
  if (raw.includes(" — ")) return raw.split(" — ", 1)[0].trim();
  return raw.replace(/\s+S\d+E\d+.*$/i, "").trim() || raw;
}

export function watchlistPayloadFromLibraryItem(item: LibraryItem): WatchlistAddPayload {
  const stremio = (item.stremio_id || "").trim();
  const seriesTitle = seriesTitleFromLibrary(item);

  if (item.media_type === "series" && item.season != null && item.episode != null) {
    const epLabel = item.episode_title || `S${item.season}E${item.episode}`;
    return {
      kind: "episode",
      tmdb_id: item.tmdb_id ?? undefined,
      stremio_id: stremio || undefined,
      series_title: seriesTitle,
      media_type: "series",
      season: item.season,
      episode: item.episode,
      title: item.episode_title
        ? `${item.episode}. ${item.episode_title}`
        : epLabel,
      poster: item.poster || item.thumbnail,
      year: item.tmdb_year,
      library_item_id: item.id,
    };
  }

  if (stremio && item.media_type === "series") {
    return {
      kind: "series",
      stremio_id: stremio,
      series_title: seriesTitle,
      media_type: "series",
      title: seriesTitle,
      poster: item.poster || item.thumbnail,
      year: item.tmdb_year,
      library_item_id: item.id,
    };
  }

  if (item.tmdb_id && item.media_type) {
    if (item.media_type === "series") {
      return {
        kind: "series",
        tmdb_id: item.tmdb_id,
        stremio_id: stremio || undefined,
        series_title: seriesTitle,
        media_type: "series",
        title: seriesTitle,
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
  if (!item.linked) return null;
  if (item.media_type === "series" && item.season != null && item.episode != null) {
    return `S${String(item.season).padStart(2, "0")}E${String(item.episode).padStart(2, "0")}`;
  }
  if (item.stremio_id) return "Anime";
  if (item.media_type === "series") return "Series";
  if (item.tmdb_id) return "Movie";
  return null;
}
