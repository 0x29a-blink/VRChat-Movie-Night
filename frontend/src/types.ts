export interface Job {
  id: string;
  type: "youtube" | "m3u8" | "torrent";
  source: string;
  title: string;
  status: "queued" | "caching" | "downloading" | "completed" | "failed" | "cancelled";
  percent: number;
  speed: string;
  eta: string;
  downloaded: number;
  total: number;
  output_path: string;
  error: string;
  created_at: string;
  updated_at: string;
  link_tmdb_id?: number | null;
  link_status?: "pending" | "linked" | "failed" | "";
  link_error?: string;
}

export interface LibraryItem {
  id: number;
  path: string;
  filename: string;
  title: string;
  display_title?: string;
  folder: "youtube" | "m3u8" | "torrents";
  size: number;
  duration: number;
  thumbnail: string;
  poster?: string;
  tmdb_id?: number | null;
  media_type?: "movie" | "series" | null;
  season?: number | null;
  episode?: number | null;
  tmdb_title?: string;
  tmdb_poster?: string;
  tmdb_year?: string;
  episode_title?: string;
  stremio_id?: string | null;
  linked?: boolean;
  on_watchlist?: boolean;
  playback_audio_index?: number | null;
  playback_subtitle_index?: number | null;
  playback_burn_subtitles?: boolean;
  added_at: string;
}

export interface QueueItem {
  id: number;
  library_path: string;
  title: string;
  thumbnail: string;
  duration: number;
  position: number;
  queued_by?: string;
  prepare_status?: string;
}

export interface AppEvent {
  id: number;
  created_at: string;
  user_id: number | null;
  username: string;
  kind: string;
  title: string;
  detail: string;
}

export interface QueueSnapshot {
  items: QueueItem[];
  current_index: number;
  current: QueueItem | null;
}

export interface PlayerState {
  media_state: string;
  duration: number;
  cursor: number;
  current: QueueItem | null;
  current_index: number;
  volume_percent?: number;
  queue_loop?: boolean;
}

export interface SearchResult {
  tmdb_id: number;
  type: "movie" | "series";
  title: string;
  year: string;
  overview: string;
  poster: string;
  rating: number;
  /** kitsu:…, mal:…, anilist:… when opened via AIOStreams meta */
  stremio_id?: string;
  anime_native?: boolean;
}

export interface DownloadLinkMeta {
  tmdb_id?: number;
  stremio_id?: string;
  series_title?: string;
  media_type: "movie" | "series";
  season?: number;
  episode?: number;
  watchlist_item_id?: number;
}

export interface CatalogInfo {
  type: string;
  id: string;
  name: string;
  extras: { name: string; required: boolean; options: string[] }[];
}

export interface BrowseItem {
  stremio_id: string;
  kind: "collection" | "anime" | "title";
  type: string;
  title: string;
  year: string;
  overview: string;
  poster: string;
  rating: number;
}

export type BrowseOpenResult =
  | {
      action: "title";
      title: SearchResult;
    }
  | {
      action: "collection";
      collection_id: number;
      name: string;
      overview: string;
      poster: string;
      movies: SearchResult[];
    };

export interface TmdbCollectionSummary {
  collection_id: number;
  name: string;
  overview: string;
  poster: string;
}

export interface StreamResult {
  url: string;
  name: string;
  description: string;
  filename: string;
  provider?: string;
  resolution: string;
  resolution_rank: number;
  codec: string;
  source: string;
  hdr: string;
  size_gb: number;
  size_bytes: number;
  seeders: number;
  cached: boolean;
  playable: boolean;
  cacheable: boolean;
  playback_cacheable?: boolean;
  audio_lang: string;
  subtitle_type: string;
  lang_tags: string[];
  audio_lang_rank: number;
  languages: string[];
  subtitle_langs: string[];
  audio_tags: string[];
  visual_tags: string[];
  release_group: string;
  network: string;
  indexer: string;
  magnet: string;
  info_hash: string;
  file_idx: number | null;
}

export interface MediaStreamTrack {
  index: number;
  codec: string;
  language: string;
  title: string;
  label: string;
  audio_index?: number;
  subtitle_index?: number;
}

export interface LibraryTracksResponse {
  item_id: number;
  path: string;
  playback_audio_index: number | null;
  playback_subtitle_index: number | null;
  playback_burn_subtitles: boolean;
  audio: MediaStreamTrack[];
  subtitles: MediaStreamTrack[];
  error?: string;
}

export interface Settings {
  obs_host: string;
  obs_port: number;
  obs_password: string;
  obs_media_input: string;
  obs_scene: string;
  tmdb_api_key: string;
  aiostreams_auto: boolean;
  aiostreams_base: string;
  aiostreams_base_effective: string;
  aiostreams_base_discovered: string;
  torbox_api_key: string;
  max_concurrent_downloads: number;
  use_deno: boolean;
  skip_small: number;
  skip_large: number;
  queue_loop: boolean;
  obs_media_volume: number;
  hls_public_host: string;
  hls_stream_path: string;
  preserve_torrent_tracks?: boolean;
  obs_password_set?: boolean;
  tmdb_api_key_set?: boolean;
  torbox_api_key_set?: boolean;
}

export interface ProviderCheckResult {
  ok: boolean;
  detail?: string;
}

export interface PreflightStatus {
  api: boolean;
  obs_connected: boolean;
  obs_streaming: boolean;
  mediamtx_running: boolean;
  hls_stream_active: boolean;
  hls_reachable: boolean;
  hls_error?: string;
  hls_url: string;
  hls_path?: string;
  aiostreams_ok?: boolean;
  aiostreams_base?: string;
  aiostreams_detail?: string;
  users: number;
  tools?: { name: string; ok: boolean; detail?: string }[];
  providers?: { name: string; ok: boolean; detail?: string }[];
  issues?: string[];
  checklist_ok?: boolean;
  ready: boolean;
}

export interface BackupImportResult {
  ok: boolean;
  groups: number;
  items: number;
  ratings: number;
  watch_status: number;
  comments: number;
  wheel_presets: number;
  settings_merged: number;
  users_mapped: number;
  pre_import_snapshot?: string;
}

export interface BackupImportPreview {
  ok: boolean;
  exported_at: string | null;
  users_matched: number;
  users_unmatched: string[];
  groups: number;
  items: number;
  ratings: number;
  watch_status: number;
  comments: number;
  watchlist_item_user_exclusions: number;
  wheel_presets: number;
  library_items_total: number;
  library_links_resolvable: number;
  settings_keys: number;
}

export interface UserInfo {
  id: number;
  username: string;
  role: "admin" | "member";
  watchlist_stats_excluded?: boolean;
  allow_local_download?: boolean;
  capabilities?: {
    can_manage_settings: boolean;
    can_manage_users: boolean;
    can_manage_streaming: boolean;
    can_control_player: boolean;
    can_download_to_server: boolean;
    can_open_torbox_local_download: boolean;
    can_manage_watchlist: boolean;
  };
  created_at?: string;
}

export interface MeResponse {
  authenticated: boolean;
  user: UserInfo | null;
}

export interface WatchlistGroup {
  id: number;
  name: string;
  sort_order: number;
  wheel_enabled: boolean;
  counts: { to_watch: number; watched: number; needs_rating?: number };
}

export interface WatchlistWheelCandidate {
  id: number;
  title: string;
  poster: string;
}

export interface WatchlistWheelResult {
  item: WatchlistItem;
  winner_index: number;
  winner_id: number;
  candidates: WatchlistWheelCandidate[];
  custom?: boolean;
}

export interface WheelPreset {
  id: number;
  name: string;
  labels: string[];
  sort_order: number;
}

export interface WatchlistUserWatch {
  user_id: number;
  username: string;
  watched: boolean;
  episodes_watched?: number;
  episodes_total?: number;
}

export interface WatchlistItem {
  id: number;
  group_id: number | null;
  parent_id: number | null;
  kind: "movie" | "series" | "episode" | "collection";
  tmdb_id: number | null;
  stremio_id?: string | null;
  media_type: string;
  season: number | null;
  episode: number | null;
  title: string;
  poster: string;
  year: string;
  overview?: string;
  air_date?: string;
  library_item_id: number | null;
  list_section: "to_watch" | "watched";
  sort_order: number;
  my_watched: boolean;
  my_rating: number | null;
  my_watched_at?: string | null;
  my_needs_rating?: boolean;
  my_unrated_count?: number;
  user_watch: WatchlistUserWatch[];
  watched_by: { user_id: number; username: string }[];
  everyone_watched: boolean;
  group_watch_progress?: string | null;
  group_episode_progress?: string | null;
  ratings: { user_id: number; username: string; stars: number }[];
  comment_count: number;
  children?: WatchlistItem[];
  my_episode_progress?: string | null;
  library_match?: LibraryItem | null;
}

export interface MovieNightSession {
  id: number;
  group_id: number | null;
  watchlist_item_id: number | null;
  library_item_id: number | null;
  state: "picking" | "queued" | "playing" | "rating" | "ended";
  started_by_user_id: number | null;
  created_at: string | null;
  ended_at: string | null;
  watchlist_item_title?: string;
  watchlist_item_poster?: string;
  library_item_title?: string;
  library_path?: string;
  needs_download?: boolean;
}

export interface WatchlistComment {
  id: number;
  body: string;
  created_at: string;
  user_id: number;
  username: string;
}

export interface TmdbEpisode {
  episode_number: number;
  name: string;
  overview: string;
  air_date: string;
  still: string;
  /** Stremio video id for AIOStreams stream lookup (anime) */
  video_stremio_id?: string;
}

export interface StatsTitle {
  id: number;
  title: string;
  poster: string;
  year: string;
  kind: "movie" | "series";
  watched_count: number;
  everyone_watched: boolean;
  latest_watched_at: string | null;
  ratings: { user_id: number; username: string; stars: number }[];
  rating_count: number;
  avg_stars: number | null;
  rating_stddev: number | null;
  unanimous_five: boolean;
  comment_count: number;
  group_episode_progress?: string | null;
}

export interface StatsProfileTitle {
  id: number;
  title: string;
  poster: string;
  year: string;
  kind: string;
  user_watched: boolean;
  user_rating: number | null;
  user_watched_at: string | null;
  user_commented: boolean;
  user_needs_rating: boolean;
}

export interface StatsUserProfile {
  user_id: number;
  username: string;
  watched_count: number;
  ratings_given: number;
  avg_rating: number | null;
  comments_given: number;
  needs_rating_count: number;
  titles: StatsProfileTitle[];
}

export interface StatsUserRow {
  user_id: number;
  username: string;
  watched_count: number;
  ratings_given: number;
  avg_rating_given: number | null;
}

export interface StatsNeedsRatingTitle {
  item_id: number;
  title: string;
  watched_at: string | null;
}

export interface StatsNeedsRatingUser {
  user_id: number;
  username: string;
  titles: StatsNeedsRatingTitle[];
  more: number;
}

export interface StatsTimelineDayCount {
  date: string;
  count: number;
}

export interface StatsTimeline {
  days: number;
  watch_counts: StatsTimelineDayCount[];
  rating_counts: StatsTimelineDayCount[];
  busiest_day: StatsTimelineDayCount | null;
  rating_lag_days: number | null;
}

export interface StatsSummary {
  group_id: number | null;
  group_name: string;
  users: { user_id: number; username: string }[];
  selected_user_ids: number[] | null;
  overview: {
    total_titles: number;
    watched_by_anyone: number;
    everyone_watched: number;
    total_ratings: number;
    avg_stars_all: number | null;
    active_users: number;
  };
  top_rated: StatsTitle[];
  worst_rated: StatsTitle[];
  perfect_scores: StatsTitle[];
  everyone_watched: StatsTitle[];
  most_divisive: StatsTitle[];
  recently_watched: StatsTitle[];
  most_commented: StatsTitle[];
  user_leaderboard: StatsUserRow[];
  needs_rating: StatsNeedsRatingUser[];
  profile: StatsUserProfile | null;
}
