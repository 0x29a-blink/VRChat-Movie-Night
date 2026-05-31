async function req<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.detail || detail;
    } catch {
      /* ignore */
    }
    const err = new Error(detail) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

const get = <T>(p: string) => req<T>(p);
const post = <T>(p: string, body?: unknown) =>
  req<T>(p, { method: "POST", body: body ? JSON.stringify(body) : undefined });
const put = <T>(p: string, body?: unknown) =>
  req<T>(p, { method: "PUT", body: body ? JSON.stringify(body) : undefined });
const del = <T>(p: string) => req<T>(p, { method: "DELETE" });

const patch = <T>(p: string, body?: unknown) =>
  req<T>(p, { method: "PATCH", body: body ? JSON.stringify(body) : undefined });

export const api = {
  // auth
  me: () => get<import("./types").MeResponse>("/api/me"),
  login: (username: string, password: string) => post("/api/login", { username, password }),
  logout: () => post("/api/logout"),
  changePassword: (new_password: string) => post("/api/password", { new_password }),

  // users (admin)
  listUsers: () => get<{ users: import("./types").UserInfo[] }>("/api/users"),
  createUser: (username: string, password: string, role = "member") =>
    post<{ user: import("./types").UserInfo; password: string }>("/api/users", { username, password, role }),
  deleteUser: (id: number) => del(`/api/users/${id}`),
  resetUserPassword: (id: number, password: string) =>
    post<{ ok: boolean; password: string }>(`/api/users/${id}/reset-password`, { password }),

  // downloads
  listDownloads: () => get<import("./types").Job[]>("/api/downloads"),
  ytDownload: (url: string, link?: import("./types").DownloadLinkMeta) =>
    post("/api/downloads/youtube", { url, link }),
  m3u8Download: (
    url: string,
    title = "",
    referer = "",
    link?: import("./types").DownloadLinkMeta
  ) => post("/api/downloads/m3u8", { url, title, referer, link }),
  torrentDownload: (payload: {
    url?: string;
    title?: string;
    cache_first?: boolean;
    magnet?: string;
    info_hash?: string;
    file_idx?: number | null;
    filename?: string;
    size_bytes?: number;
    link?: import("./types").DownloadLinkMeta;
  }) => post("/api/downloads/torrent", payload),
  cancelDownload: (id: string) => post(`/api/downloads/${id}/cancel`),
  restartDownload: (id: string) => post(`/api/downloads/${id}/restart`),
  removeDownload: (id: string) => del(`/api/downloads/${id}`),

  // search
  search: (q: string) => get<import("./types").SearchResult[]>(`/api/search?q=${encodeURIComponent(q)}`),
  titleDetails: (tmdbId: number, type: string) =>
    get<{
      tmdb_id: number;
      type: string;
      title: string;
      year: string;
      overview: string;
      poster: string;
      seasons: { season_number: number; name: string; episode_count: number }[];
    }>(`/api/title/${tmdbId}?type=${type}`),
  seasonEpisodes: (tmdbId: number, season: number) =>
    get<{ episodes: import("./types").TmdbEpisode[] }>(`/api/title/${tmdbId}/season/${season}/episodes`),
  streams: (tmdbId: number, type: string, season?: number, episode?: number) => {
    let url = `/api/streams?tmdb_id=${tmdbId}&type=${type}`;
    if (season) url += `&season=${season}`;
    if (episode) url += `&episode=${episode}`;
    return get<{ imdb_id: string; streams: import("./types").StreamResult[] }>(url);
  },
  streamsStremio: (videoId: string, stremioId?: string, season?: number, episode?: number) => {
    let url = `/api/streams/stremio?video_id=${encodeURIComponent(videoId)}`;
    if (stremioId) url += `&stremio_id=${encodeURIComponent(stremioId)}`;
    if (season != null) url += `&season=${season}`;
    if (episode != null) url += `&episode=${episode}`;
    return get<{ video_id: string; streams: import("./types").StreamResult[] }>(url);
  },

  browseCatalogs: () =>
    get<{
      catalogs: import("./types").CatalogInfo[];
      anime_catalog_key?: string | null;
    }>("/api/browse/catalogs"),
  browseItems: (
    type: string,
    id: string,
    skip = 0,
    search = "",
    extras?: Record<string, string>
  ) => {
    let url = `/api/browse/items?type=${encodeURIComponent(type)}&id=${encodeURIComponent(id)}&skip=${skip}`;
    if (search) url += `&search=${encodeURIComponent(search)}`;
    if (extras) {
      for (const [k, v] of Object.entries(extras)) {
        if (v !== "") url += `&${encodeURIComponent(k)}=${encodeURIComponent(v)}`;
      }
    }
    return get<{ items: import("./types").BrowseItem[]; has_more: boolean }>(url);
  },
  animeMeta: (stremioId: string) =>
    get<{ title: import("./types").SearchResult; seasons: { season_number: number; name: string; episode_count: number }[] }>(
      `/api/browse/anime/meta?stremio_id=${encodeURIComponent(stremioId)}`
    ),
  animeSeasonEpisodes: (stremioId: string, season: number) =>
    get<{ episodes: import("./types").TmdbEpisode[] }>(
      `/api/browse/anime/season/${season}/episodes?stremio_id=${encodeURIComponent(stremioId)}`
    ),
  browseOpen: (stremioId: string, type: string) =>
    get<import("./types").BrowseOpenResult>(
      `/api/browse/open?stremio_id=${encodeURIComponent(stremioId)}&type=${encodeURIComponent(type)}`
    ),
  browseCollections: (q: string) =>
    get<{ collections: import("./types").TmdbCollectionSummary[] }>(
      `/api/browse/collections?q=${encodeURIComponent(q)}`
    ),
  browseCollection: (collectionId: number) =>
    get<{
      collection_id: number;
      name: string;
      overview: string;
      poster: string;
      movies: import("./types").SearchResult[];
    }>(`/api/browse/collections/${collectionId}`),

  // library
  library: () => get<Record<string, import("./types").LibraryItem[]>>("/api/library"),
  libraryByPath: (path: string) =>
    get<{ item: import("./types").LibraryItem | null }>(
      `/api/library/by-path?path=${encodeURIComponent(path)}`
    ),
  libraryTracks: (id: number) => get<import("./types").LibraryTracksResponse>(`/api/library/${id}/tracks`),
  setLibraryPlayback: (
    id: number,
    body: {
      playback_audio_index?: number | null;
      playback_subtitle_index?: number | null;
      playback_burn_subtitles?: boolean;
    }
  ) => patch<import("./types").LibraryItem>(`/api/library/${id}/playback`, body),
  applyLibraryPlayback: (id: number) =>
    post<{ ok: boolean; playback_path: string }>(`/api/library/${id}/playback/apply`),
  libraryMatch: (opts: {
    mediaType: "movie" | "series";
    tmdbId?: number;
    stremioId?: string;
    season?: number;
    episode?: number;
  }) => {
    const params = new URLSearchParams({ media_type: opts.mediaType });
    if (opts.tmdbId != null) params.set("tmdb_id", String(opts.tmdbId));
    if (opts.stremioId) params.set("stremio_id", opts.stremioId);
    if (opts.season != null) params.set("season", String(opts.season));
    if (opts.episode != null) params.set("episode", String(opts.episode));
    return get<{ match: import("./types").LibraryItem | null }>(`/api/library/match?${params}`);
  },
  scanLibrary: () => post("/api/library/scan"),
  renameLibraryItem: (id: number, title: string) =>
    req<import("./types").LibraryItem>(`/api/library/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ title }),
    }),
  linkLibraryItem: (
    id: number,
    payload: {
      tmdb_id: number;
      media_type: "movie" | "series";
      season?: number;
      episode?: number;
    }
  ) => post<import("./types").LibraryItem>(`/api/library/${id}/link`, payload),
  unlinkLibraryItem: (id: number) => post<import("./types").LibraryItem>(`/api/library/${id}/unlink`),
  deleteLibraryItem: (id: number) => del(`/api/library/${id}`),

  // queue
  queue: () => get<import("./types").QueueSnapshot>("/api/queue"),
  queueAdd: (library_id: number) =>
    post<import("./types").QueueSnapshot>("/api/queue/add", { library_id }),
  queueRemove: (id: number) => del<import("./types").QueueSnapshot>(`/api/queue/${id}`),
  queueClear: () => post<import("./types").QueueSnapshot>("/api/queue/clear"),
  queueReorder: (ids: number[]) =>
    post<import("./types").QueueSnapshot>("/api/queue/reorder", { ids }),

  // player
  playerStatus: () => get<import("./types").PlayerState>("/api/player/status"),
  play: (index?: number) => post<import("./types").QueueSnapshot>("/api/player/play", { index }),
  pause: () => post("/api/player/pause"),
  resume: () => post("/api/player/resume"),
  toggle: () => post("/api/player/toggle"),
  stop: () => post("/api/player/stop"),
  next: () => post("/api/player/next"),
  prev: () => post("/api/player/prev"),
  seek: (ms: number) => post("/api/player/seek", { ms }),
  skip: (seconds: number) => post("/api/player/skip", { seconds }),
  setVolume: (percent: number) => post("/api/player/volume", { percent }),
  setQueueLoop: (enabled: boolean) => post("/api/player/loop", { enabled }),

  // obs
  obsStatus: () => get<{ connected: boolean; streaming: boolean; error?: string }>("/api/obs/status"),
  obsStreamStart: () => post("/api/obs/stream/start"),
  obsStreamStop: () => post("/api/obs/stream/stop"),

  preflight: () => get<import("./types").PreflightStatus>("/api/health/preflight"),
  hlsUrl: () => get<{ url: string }>("/api/health/hls-url"),

  // settings
  getSettings: () => get<import("./types").Settings>("/api/settings"),
  saveSettings: (values: Partial<import("./types").Settings>) =>
    put<import("./types").Settings>("/api/settings", values),
  reloadAiostreamsConfig: () =>
    post<{
      ok: boolean;
      discovered: string;
      aiostreams_auto: boolean;
      aiostreams_base: string;
      aiostreams_base_effective: string;
      aiostreams_base_discovered: string;
    }>("/api/settings/aiostreams/reload"),
  resetAiostreamsAuto: () => post<import("./types").Settings>("/api/settings/aiostreams/reset-auto"),
  testObs: () => post<{ connected: boolean; streaming: boolean; error?: string }>("/api/settings/test-obs"),

  // watchlist
  watchlistGroups: () =>
    get<{ groups: import("./types").WatchlistGroup[]; ungrouped_counts: { to_watch: number; watched: number } }>(
      "/api/watchlist/groups"
    ),
  watchlistCreateGroup: (name: string) =>
    post<import("./types").WatchlistGroup>("/api/watchlist/groups", { name }),
  watchlistPatchGroup: (id: number, patch_: Partial<{ name: string; sort_order: number; wheel_enabled: boolean }>) =>
    patch<import("./types").WatchlistGroup>(`/api/watchlist/groups/${id}`, patch_),
  watchlistDeleteGroup: (id: number) => del(`/api/watchlist/groups/${id}`),
  watchlistGroupItems: (groupId: number, section?: string) => {
    let url = `/api/watchlist/groups/${groupId}/items`;
    if (section) url += `?section=${section}`;
    return get<{ items: import("./types").WatchlistItem[]; counts: { to_watch: number; watched: number } }>(url);
  },
  watchlistAddItem: (payload: {
    kind: string;
    tmdb_id?: number;
    stremio_id?: string;
    series_title?: string;
    media_type?: string;
    season?: number;
    episode?: number;
    title?: string;
    poster?: string;
    year?: string;
    overview?: string;
    air_date?: string;
    group_id?: number | null;
    parent_id?: number | null;
    library_item_id?: number;
  }) => post<import("./types").WatchlistItem>("/api/watchlist/items", payload),
  watchlistPatchItem: (id: number, patch_: Record<string, unknown>) =>
    patch<import("./types").WatchlistItem>(`/api/watchlist/items/${id}`, patch_),
  watchlistDeleteItem: (id: number) => del(`/api/watchlist/items/${id}`),
  watchlistSetSection: (id: number, list_section: "to_watch" | "watched") =>
    post(`/api/watchlist/items/${id}/section`, { list_section }),
  watchlistSetWatched: (id: number, watched: boolean) =>
    put<import("./types").WatchlistItem>(`/api/watchlist/items/${id}/watched`, { watched }),
  watchlistSetRating: (id: number, stars: number) =>
    put<import("./types").WatchlistItem>(`/api/watchlist/items/${id}/rating`, { stars }),
  watchlistComments: (id: number) =>
    get<{ comments: import("./types").WatchlistComment[] }>(`/api/watchlist/items/${id}/comments`),
  watchlistAddComment: (id: number, body: string) =>
    post<import("./types").WatchlistComment>(`/api/watchlist/items/${id}/comments`, { body }),
  watchlistReorder: (items: { id: number; sort_order: number; parent_id?: number | null; group_id?: number | null }[]) =>
    post("/api/watchlist/items/reorder", { items }),
  watchlistWheel: (
    groupId: number,
    opts: {
      include_watched_by_me?: boolean;
      include_unwatched_by_me?: boolean;
      item_ids?: number[];
    } = {}
  ) =>
    post<import("./types").WatchlistWheelResult>(`/api/watchlist/groups/${groupId}/wheel`, {
      include_watched_by_me: opts.include_watched_by_me ?? true,
      include_unwatched_by_me: opts.include_unwatched_by_me ?? true,
      item_ids: opts.item_ids?.length ? opts.item_ids : undefined,
    }),
  watchlistCustomWheel: (labels: string[]) =>
    post<import("./types").WatchlistWheelResult>("/api/watchlist/wheel/custom", { labels }),
  watchlistWheelPresets: () =>
    get<{ presets: import("./types").WheelPreset[] }>("/api/watchlist/wheel-presets"),
  watchlistCreateWheelPreset: (name: string, labels: string[]) =>
    post<import("./types").WheelPreset>("/api/watchlist/wheel-presets", { name, labels }),
  watchlistDeleteWheelPreset: (id: number) => del(`/api/watchlist/wheel-presets/${id}`),
  watchlistAddEpisodes: (seriesId: number, episodes: { season: number; episode: number; title?: string; still?: string }[]) =>
    post<{ created: import("./types").WatchlistItem[] }>(`/api/watchlist/items/${seriesId}/episodes`, { episodes }),
  watchlistSeasonCatalog: (seriesId: number) =>
    get<{
      seasons: {
        season_number: number;
        name: string;
        episode_count: number;
        on_watchlist: number;
      }[];
      stremio_id?: string | null;
      tmdb_id?: number | null;
      catalog_source?: "tmdb" | "anime" | "watchlist_only";
    }>(`/api/watchlist/items/${seriesId}/season-catalog`),
  watchlistAddSeasons: (seriesId: number, seasons: number[]) =>
    post<{
      added: number;
      skipped_duplicates: number;
      series: import("./types").WatchlistItem;
    }>(`/api/watchlist/items/${seriesId}/add-seasons`, { seasons }),
  watchlistLinkTmdbCatalog: (seriesId: number, tmdbId: number, updateDisplay = true) =>
    post<{
      series: import("./types").WatchlistItem;
      catalog_source: string;
    }>(`/api/watchlist/items/${seriesId}/link-tmdb-catalog`, {
      tmdb_id: tmdbId,
      media_type: "series",
      update_display: updateDisplay,
    }),

  watchlistQueueUnwatched: (groupId: number) =>
    post<{ added: number; skipped: number; eligible: number }>(`/api/watchlist/groups/${groupId}/queue-unwatched`),
  watchlistPlayNextUnwatched: (groupId: number) =>
    post<{ title: string; library_id: number }>(`/api/watchlist/groups/${groupId}/play-next-unwatched`),

  // stats
  getStats: (groupId?: number | null) => {
    let url = "/api/stats";
    if (groupId != null) url += `?group_id=${groupId}`;
    return get<import("./types").StatsSummary>(url);
  },

  exportBackup: async () => {
    const res = await fetch("/api/backup/export", { credentials: "include" });
    if (!res.ok) {
      let detail = res.statusText;
      try {
        const body = await res.json();
        detail = body.detail || detail;
      } catch {
        /* ignore */
      }
      throw new Error(detail);
    }
    const blob = await res.blob();
    const disp = res.headers.get("Content-Disposition") ?? "";
    const match = disp.match(/filename=\"?([^\";]+)/);
    const filename = match?.[1] ?? "movie-night-backup.json";
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  },

  importBackup: (data: unknown) =>
    post<import("./types").BackupImportResult>("/api/backup/import", { data }),
};
