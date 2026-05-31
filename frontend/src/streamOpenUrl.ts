export type StreamOpenParams = {
  type: "movie" | "series";
  tmdb_id?: number;
  stremio_id?: string;
  season?: number;
  episode?: number;
};

export type StreamLaunch =
  | { source: "tmdb"; raw: string }
  | { source: "stremio"; stremio_id: string; media: "movie" | "series" };

export function encodeTmdbStreamOpen(params: StreamOpenParams & { tmdb_id: number }): string {
  const parts = [String(params.tmdb_id), params.type];
  if (params.season != null) parts.push(String(params.season));
  if (params.episode != null) parts.push(String(params.episode));
  return parts.join(":");
}

export function decodeTmdbStreamOpen(raw: string): (StreamOpenParams & { tmdb_id: number }) | null {
  const parts = raw.split(":");
  if (parts.length < 2) return null;
  const tmdb_id = Number(parts[0]);
  if (!Number.isFinite(tmdb_id)) return null;
  const type = parts[1] === "series" ? "series" : "movie";
  const season = parts[2] != null && parts[2] !== "" ? Number(parts[2]) : undefined;
  const episode = parts[3] != null && parts[3] !== "" ? Number(parts[3]) : undefined;
  if (season != null && !Number.isFinite(season)) return null;
  if (episode != null && !Number.isFinite(episode)) return null;
  return { tmdb_id, type, season, episode };
}

export function streamOpenFromSearchResult(r: {
  tmdb_id: number;
  type: "movie" | "series";
}): StreamOpenParams {
  return { tmdb_id: r.tmdb_id, type: r.type };
}

export function streamOpenFromBrowseItem(item: {
  stremio_id: string;
  kind: string;
  type: string;
  tmdb_id?: number;
}): StreamOpenParams | null {
  if (item.kind === "collection") return null;
  const media = item.type === "series" ? "series" : "movie";
  if (item.tmdb_id != null && Number.isFinite(item.tmdb_id)) {
    return { tmdb_id: item.tmdb_id, type: media };
  }
  const sid = (item.stremio_id || "").trim();
  if (!sid) return null;
  if (sid.startsWith("tmdb:")) {
    const n = Number(sid.split(":", 2)[1]);
    if (Number.isFinite(n)) return { tmdb_id: n, type: media };
  } else if (/^\d+$/.test(sid)) {
    return { tmdb_id: Number(sid), type: media };
  }
  return { stremio_id: sid, type: media };
}

export function streamOpenHref(params: StreamOpenParams): string {
  if (params.tmdb_id != null) {
    return `/?open=${encodeURIComponent(encodeTmdbStreamOpen({ ...params, tmdb_id: params.tmdb_id }))}`;
  }
  if (params.stremio_id) {
    const q = new URLSearchParams({ openStremio: params.stremio_id, media: params.type });
    return `/?${q.toString()}`;
  }
  return "/";
}

export function openStreamInNewTab(params: StreamOpenParams): void {
  window.open(streamOpenHref(params), "_blank", "noopener,noreferrer");
}

export function readStreamLaunchFromLocation(): StreamLaunch | null {
  const params = new URLSearchParams(window.location.search);
  const stremio = params.get("openStremio");
  if (stremio) {
    return {
      source: "stremio",
      stremio_id: stremio,
      media: params.get("media") === "series" ? "series" : "movie",
    };
  }
  const open = params.get("open");
  if (open) return { source: "tmdb", raw: open };
  return null;
}

export function clearStreamLaunchFromLocation(): void {
  const url = new URL(window.location.href);
  let changed = false;
  for (const key of ["open", "openStremio", "media"]) {
    if (url.searchParams.has(key)) {
      url.searchParams.delete(key);
      changed = true;
    }
  }
  if (!changed) return;
  const next = url.pathname + (url.search || "") + url.hash;
  window.history.replaceState({}, "", next);
}

/** @deprecated use decodeTmdbStreamOpen */
export function decodeStreamOpen(raw: string) {
  return decodeTmdbStreamOpen(raw);
}

/** @deprecated use readStreamLaunchFromLocation */
export function readStreamOpenFromLocation(): string | null {
  const launch = readStreamLaunchFromLocation();
  if (!launch) return null;
  if (launch.source === "tmdb") return launch.raw;
  return null;
}

/** @deprecated use clearStreamLaunchFromLocation */
export function clearStreamOpenFromLocation(): void {
  clearStreamLaunchFromLocation();
}
