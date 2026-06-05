import { Download, HardDriveDownload, ListPlus, Loader2, Play, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../api";
import type { StreamResult, TmdbEpisode } from "../types";
import { AddToWatchlistButton } from "./AddToWatchlist";
import { downloadLinkMetaFromTarget, watchlistPayloadFromTarget } from "./downloadLinkMeta";
import { InLibraryChip } from "./InLibraryChip";
import { ManualStreamForm } from "./ManualStreamForm";
import { StreamResultsPanel } from "./StreamFiltersPanel";
import { usePlayback } from "./PlaybackContext";
import type { StreamTarget } from "./streamTarget";
import { loadStreamFilters, saveStreamFilters } from "../streamFilters";
import { copyStreamDownloadLink, saveLibraryItemToPc, saveStreamToPc } from "../localDownload";
import { useToast } from "./Toast";
import { filterAndSortStreams, streamKey } from "../streamListUtils";

const INITIAL_FILTERS = loadStreamFilters();

export function TitleStreamsModal({
  open,
  target,
  onClose,
  allowLocalDownload = false,
}: {
  open: boolean;
  target: StreamTarget | null;
  onClose: () => void;
  allowLocalDownload?: boolean;
}) {
  const { push: pushToast } = useToast();
  const { playFromLibrary, queueFromLibrary } = usePlayback();
  const [seasons, setSeasons] = useState<{ season_number: number; name: string; episode_count: number }[]>([]);
  const [season, setSeason] = useState<number | undefined>();
  const [episode, setEpisode] = useState<number | undefined>();
  const [episodes, setEpisodes] = useState<TmdbEpisode[]>([]);
  const [loadingEpisodes, setLoadingEpisodes] = useState(false);

  const [streams, setStreams] = useState<StreamResult[]>([]);
  const [loadingStreams, setLoadingStreams] = useState(false);
  const [streamsFetched, setStreamsFetched] = useState(false);
  const [grabbed, setGrabbed] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  const [playbackBusy, setPlaybackBusy] = useState(false);
  const streamsRequest = useRef(0);

  const [minRes, setMinRes] = useState(INITIAL_FILTERS.minRes);
  const [codec, setCodec] = useState(INITIAL_FILTERS.codec);
  const [maxSize, setMaxSize] = useState(INITIAL_FILTERS.maxSize);
  const [cachedOnly, setCachedOnly] = useState(INITIAL_FILTERS.cachedOnly);
  const [minSeeders, setMinSeeders] = useState(INITIAL_FILTERS.minSeeders);
  const [sortBy, setSortBy] = useState<"quality" | "size" | "seeders">(INITIAL_FILTERS.sortBy);
  const [audioLang, setAudioLang] = useState(INITIAL_FILTERS.audioLang);
  const [subtitleType, setSubtitleType] = useState(INITIAL_FILTERS.subtitleType);
  const [preferDub, setPreferDub] = useState(INITIAL_FILTERS.preferDub);
  const [searchText, setSearchText] = useState("");
  const [downloadQueued, setDownloadQueued] = useState(false);

  useEffect(() => {
    saveStreamFilters({
      searchText,
      minRes,
      codec,
      maxSize,
      cachedOnly,
      minSeeders,
      sortBy,
      audioLang,
      subtitleType,
      preferDub,
    });
  }, [searchText, minRes, codec, maxSize, cachedOnly, minSeeders, sortBy, audioLang, subtitleType, preferDub]);

  useEffect(() => {
    if (!open || !target) return;
    setError("");
    setStreams([]);
    setStreamsFetched(false);
    setGrabbed(new Set());
    setDownloadQueued(false);
    setSeasons([]);
    setEpisodes([]);
    setSeason(target.season);
    setEpisode(target.episode);

    if (target.mediaType === "series" && !target.season) {
      api
        .titleDetails(target.tmdb_id, "series")
        .then((d) => setSeasons(d.seasons || []))
        .catch(() => setSeasons([]));
    } else if (target.mediaType === "movie") {
      loadStreams(target.tmdb_id, "movie");
    } else if (target.mediaType === "series" && target.season && target.episode) {
      loadStreams(target.tmdb_id, "series", target.season, target.episode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, target?.tmdb_id, target?.mediaType, target?.season, target?.episode]);

  useEffect(() => {
    if (!open || !target || target.mediaType !== "series") return;
    const s = season ?? target.season;
    if (!s) return;
    setLoadingEpisodes(true);
    api
      .seasonEpisodes(target.tmdb_id, s)
      .then((r) => setEpisodes(r.episodes))
      .catch(() => setEpisodes([]))
      .finally(() => setLoadingEpisodes(false));
  }, [open, target?.tmdb_id, target?.mediaType, season, target?.season]);

  const loadStreams = async (tmdbId: number, type: "movie" | "series", s?: number, ep?: number) => {
    const reqId = ++streamsRequest.current;
    setLoadingStreams(true);
    setStreamsFetched(true);
    setError("");
    setStreams([]);
    try {
      const res = await api.streams(tmdbId, type, s, ep);
      if (reqId !== streamsRequest.current) return;
      setStreams(res.streams);
    } catch (err: unknown) {
      if (reqId !== streamsRequest.current) return;
      setError(err instanceof Error ? err.message : "Failed to load streams");
    } finally {
      if (reqId === streamsRequest.current) setLoadingStreams(false);
    }
  };

  const onSeasonChange = async (seasonNum: number) => {
    setSeason(seasonNum);
    setEpisode(undefined);
    setStreams([]);
    setStreamsFetched(false);
    setEpisodes([]);
    if (!target) return;
    setLoadingEpisodes(true);
    try {
      const r = await api.seasonEpisodes(target.tmdb_id, seasonNum);
      setEpisodes(r.episodes);
    } catch {
      setEpisodes([]);
    } finally {
      setLoadingEpisodes(false);
    }
  };

  const pickEpisode = (ep: TmdbEpisode) => {
    setEpisode(ep.episode_number);
    setStreams([]);
    setStreamsFetched(false);
  };

  const buildDownloadTitle = (s: StreamResult) => {
    const base = target?.title || "Title";
    const activeSeason = season ?? target?.season;
    const activeEpisode = episode ?? target?.episode;
    const suffix =
      target?.mediaType === "series" && activeSeason && activeEpisode
        ? ` S${activeSeason}E${activeEpisode}`
        : "";
    return `${base}${suffix} [${s.resolution || "?"}]`;
  };

  const buildManualTitle = () => {
    const base = target?.title || "Title";
    const activeSeason = season ?? target?.season;
    const activeEpisode = episode ?? target?.episode;
    const suffix =
      target?.mediaType === "series" && activeSeason && activeEpisode
        ? ` S${activeSeason}E${activeEpisode}`
        : "";
    return `${base}${suffix}`;
  };

  const currentLinkMeta = () => {
    if (!target) return undefined;
    return downloadLinkMetaFromTarget(target, season ?? target.season, episode ?? target.episode);
  };

  const grabCached = async (s: StreamResult) => {
    try {
      await api.torrentDownload({ url: s.url, title: buildDownloadTitle(s), link: currentLinkMeta() });
      setGrabbed((prev) => new Set(prev).add(streamKey(s)));
      setDownloadQueued(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Download failed");
    }
  };

  const saveStreamLocal = async (s: StreamResult) => {
    setError("");
    try {
      await saveStreamToPc(s);
      pushToast("Opening TorBox download in your browser", "success");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Could not open TorBox link";
      setError(msg);
      pushToast(msg, "error");
    }
  };

  const copyStreamLink = async (s: StreamResult) => {
    setError("");
    try {
      await copyStreamDownloadLink(s);
      pushToast("TorBox download link copied", "success");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Could not copy link";
      setError(msg);
      pushToast(msg, "error");
    }
  };

  const saveLibraryLocal = async () => {
    const lib = target?.libraryMatch;
    if (!lib?.id) return;
    setError("");
    try {
      await saveLibraryItemToPc(lib.id);
      pushToast("Opening TorBox download in your browser", "success");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Could not open TorBox link";
      setError(msg);
      pushToast(msg, "error");
    }
  };

  const grabCache = async (s: StreamResult) => {
    const min = Number(minSeeders);
    if (min > 0 && s.seeders > 0 && s.seeders < min) {
      setError(`This torrent only has ${s.seeders} seeders (min ${min}). Pick another.`);
      return;
    }
    try {
      await api.torrentDownload({
        cache_first: true,
        url: s.url,
        magnet: s.magnet,
        info_hash: s.info_hash,
        file_idx: s.file_idx,
        filename: s.filename,
        size_bytes: s.size_bytes || undefined,
        title: buildDownloadTitle(s),
        link: currentLinkMeta(),
      });
      setGrabbed((prev) => new Set(prev).add(streamKey(s)));
      setDownloadQueued(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Cache & download failed");
    }
  };

  const addToQueue = async () => {
    const lib = target?.libraryMatch;
    if (!lib) return;
    setPlaybackBusy(true);
    setError("");
    try {
      await queueFromLibrary(lib);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not add to queue");
    } finally {
      setPlaybackBusy(false);
    }
  };

  const playNow = async () => {
    const lib = target?.libraryMatch;
    if (!lib) return;
    setPlaybackBusy(true);
    setError("");
    try {
      await playFromLibrary(lib);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not start playback");
    } finally {
      setPlaybackBusy(false);
    }
  };

  const filtered = useMemo(
    () =>
      filterAndSortStreams(streams, {
        searchText,
        minRes,
        codec,
        maxSize,
        cachedOnly,
        minSeeders,
        sortBy,
        audioLang,
        subtitleType,
        preferDub,
      }),
    [streams, searchText, minRes, codec, maxSize, cachedOnly, minSeeders, sortBy, audioLang, subtitleType, preferDub]
  );

  const updateFilters = (patch: Partial<typeof INITIAL_FILTERS>) => {
    if (patch.searchText !== undefined) setSearchText(patch.searchText);
    if (patch.minRes !== undefined) setMinRes(patch.minRes);
    if (patch.codec !== undefined) setCodec(patch.codec);
    if (patch.maxSize !== undefined) setMaxSize(patch.maxSize);
    if (patch.cachedOnly !== undefined) setCachedOnly(patch.cachedOnly);
    if (patch.minSeeders !== undefined) setMinSeeders(patch.minSeeders);
    if (patch.sortBy !== undefined) setSortBy(patch.sortBy);
    if (patch.audioLang !== undefined) setAudioLang(patch.audioLang);
    if (patch.subtitleType !== undefined) setSubtitleType(patch.subtitleType);
    if (patch.preferDub !== undefined) setPreferDub(patch.preferDub);
  };

  if (!open || !target) return null;

  const activeSeason = season ?? target.season;
  const activeEpisode = episode ?? target.episode;
  const lib = target.libraryMatch;

  return createPortal(
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/75 p-4" onClick={onClose}>
      <div
        className="card flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 border-b border-white/5 p-4">
          {target.poster ? (
            <img src={target.poster} alt="" className="h-24 w-16 shrink-0 rounded-lg object-cover" />
          ) : (
            <div className="h-24 w-16 shrink-0 rounded-lg bg-ink-800" />
          )}
          <div className="min-w-0 flex-1">
            <h3 className="text-lg font-semibold leading-tight">
              {target.title}
              {target.year && <span className="text-slate-500"> ({target.year})</span>}
            </h3>
            {target.overview && (
              <p className="mt-1 line-clamp-2 text-sm text-slate-400">{target.overview}</p>
            )}
            <div className="mt-2 flex flex-wrap gap-2">
              {lib && (
                <>
                  <button type="button" disabled={playbackBusy} onClick={playNow} className="btn-primary text-xs">
                    {playbackBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                    Play now
                  </button>
                  <button
                    type="button"
                    disabled={playbackBusy}
                    onClick={addToQueue}
                    className="btn-ghost border border-white/10 text-xs"
                  >
                    <ListPlus className="h-3.5 w-3.5" /> Add to queue
                  </button>
                  <InLibraryChip />
                  {allowLocalDownload && (
                    <button
                      type="button"
                      onClick={saveLibraryLocal}
                      className="btn-ghost border border-white/10 text-xs"
                    >
                      <HardDriveDownload className="h-3.5 w-3.5" />
                      TorBox download
                    </button>
                  )}
                </>
              )}
              {target.mediaType === "movie" && (
                <button
                  type="button"
                  disabled={loadingStreams}
                  onClick={() => loadStreams(target.tmdb_id, "movie")}
                  className="btn-ghost border border-white/10 text-xs"
                >
                  {loadingStreams ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                  Refresh streams
                </button>
              )}
            </div>
          </div>
          <button type="button" onClick={onClose} className="btn-ghost shrink-0 p-2">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-w-0 flex-1 overflow-y-auto p-4">
          {error && <div className="mb-3 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</div>}

          {target.mediaType === "series" && !target.season && (
            <div className="mb-4 space-y-4">
              <label className="text-xs text-slate-400">
                Season
                <select
                  className="input mt-1 w-48"
                  value={season ?? ""}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    if (n) onSeasonChange(n);
                    else {
                      setSeason(undefined);
                      setEpisodes([]);
                    }
                  }}
                >
                  <option value="">—</option>
                  {seasons.map((s) => (
                    <option key={s.season_number} value={s.season_number}>
                      {s.name} ({s.episode_count} eps)
                    </option>
                  ))}
                </select>
              </label>

              {loadingEpisodes && (
                <div className="flex items-center gap-2 text-sm text-slate-400">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading episodes…
                </div>
              )}

              {!loadingEpisodes && episodes.length > 0 && (
                <div className="grid gap-2 sm:grid-cols-2">
                  {episodes.map((ep) => (
                    <button
                      key={ep.episode_number}
                      type="button"
                      onClick={() => pickEpisode(ep)}
                      className={`card flex gap-3 p-2 text-left ${
                        episode === ep.episode_number ? "ring-1 ring-brand-500" : ""
                      }`}
                    >
                      {ep.still ? (
                        <img src={ep.still} alt="" className="h-14 w-24 shrink-0 rounded object-cover" />
                      ) : (
                        <div className="grid h-14 w-24 shrink-0 place-items-center rounded bg-ink-800 text-xs text-slate-500">
                          E{ep.episode_number}
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-medium">
                          {ep.episode_number}. {ep.name}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {activeSeason && activeEpisode && (
                <button
                  type="button"
                  onClick={() => loadStreams(target.tmdb_id, "series", activeSeason, activeEpisode)}
                  className="btn-primary"
                >
                  Find streams for S{activeSeason}E{activeEpisode}
                </button>
              )}
            </div>
          )}

          {target.mediaType === "series" && target.season && target.episode && !streamsFetched && (
            <button
              type="button"
              onClick={() => loadStreams(target.tmdb_id, "series", target.season, target.episode)}
              className="btn-primary mb-4"
            >
              Find streams for S{target.season}E{target.episode}
            </button>
          )}

          {loadingStreams && (
            <div className="flex items-center gap-2 py-6 text-slate-400">
              <Loader2 className="h-5 w-5 animate-spin" /> Fetching streams from AIOStreams…
            </div>
          )}

          {!loadingStreams && streams.length > 0 && (
            <StreamResultsPanel
              streams={streams}
              filtered={filtered}
              grabbed={grabbed}
              onGrabCached={grabCached}
              onGrabCache={grabCache}
              showLocalDownload={allowLocalDownload}
              onLocalDownload={saveStreamLocal}
              onCopyLink={copyStreamLink}
              filters={{
                searchText,
                minRes,
                codec,
                maxSize,
                cachedOnly,
                minSeeders,
                sortBy,
                audioLang,
                subtitleType,
                preferDub,
              }}
              onFiltersChange={updateFilters}
            />
          )}

          {!loadingStreams && streamsFetched && streams.length === 0 && (
            <div className="py-6 text-center text-sm text-slate-500">No downloadable streams found.</div>
          )}

          {downloadQueued && target && !target.watchlistItemId && (
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-brand-500/30 bg-brand-500/5 p-4">
              <div>
                <p className="text-sm font-medium text-white">Added to download queue</p>
                <p className="text-xs text-slate-400">Save this title to your watchlist to track ratings and group progress.</p>
              </div>
              <AddToWatchlistButton
                payload={watchlistPayloadFromTarget(target, season, episode)}
                label="Add to watchlist"
                className="btn-primary text-xs"
              />
            </div>
          )}

          <div className="mt-6">
            <ManualStreamForm
              title={buildManualTitle()}
              link={currentLinkMeta()}
              onError={setError}
              onQueued={() => setDownloadQueued(true)}
            />
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
