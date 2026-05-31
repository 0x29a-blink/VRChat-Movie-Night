import { Download, LayoutGrid, Loader2, Search as SearchIcon, Star } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { AddToWatchlistButton } from "./AddToWatchlist";
import { Browse } from "./Browse";
import { downloadLinkMetaFromSearch, watchlistPayloadFromSearch } from "./downloadLinkMeta";
import { InLibraryChip } from "./InLibraryChip";
import { ManualStreamForm } from "./ManualStreamForm";
import { StreamResultsPanel } from "./StreamFiltersPanel";
import { TitleMediaActions } from "./TitleMediaActions";
import { StreamOpenLink, StreamNewTabButton, BROWSE_CARD } from "./StreamOpenLink";
import type { LibraryItem, SearchResult, StreamResult, TmdbEpisode } from "../types";
import {
  clearStreamLaunchFromLocation,
  decodeTmdbStreamOpen,
  readStreamLaunchFromLocation,
  streamOpenFromSearchResult,
  type StreamLaunch,
} from "../streamOpenUrl";
import { loadStreamFilters, saveStreamFilters } from "../streamFilters";
import { filterAndSortStreams, streamKey } from "../streamListUtils";

type MoviesMode = "search" | "browse";

const INITIAL_FILTERS = loadStreamFilters();

export function Search({
  initialStreamLaunch,
  onInitialStreamOpenHandled,
}: {
  initialStreamLaunch?: StreamLaunch | null;
  onInitialStreamOpenHandled?: () => void;
}) {
  const [mode, setMode] = useState<MoviesMode>("search");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");

  const [selected, setSelected] = useState<SearchResult | null>(null);
  const [seasons, setSeasons] = useState<{ season_number: number; name: string; episode_count: number }[]>([]);
  const [season, setSeason] = useState<number | undefined>();
  const [episode, setEpisode] = useState<number | undefined>();
  const [episodes, setEpisodes] = useState<TmdbEpisode[]>([]);
  const [loadingEpisodes, setLoadingEpisodes] = useState(false);

  const [streams, setStreams] = useState<StreamResult[]>([]);
  const [loadingStreams, setLoadingStreams] = useState(false);
  const [streamsFetched, setStreamsFetched] = useState(false);
  const [grabbed, setGrabbed] = useState<Set<string>>(new Set());
  const streamsRequest = useRef(0);

  // filters
  const [minRes, setMinRes] = useState(INITIAL_FILTERS.minRes);
  const [codec, setCodec] = useState(INITIAL_FILTERS.codec);
  const [maxSize, setMaxSize] = useState(INITIAL_FILTERS.maxSize);
  const [cachedOnly, setCachedOnly] = useState(INITIAL_FILTERS.cachedOnly);
  const [minSeeders, setMinSeeders] = useState(INITIAL_FILTERS.minSeeders);
  const [sortBy, setSortBy] = useState<"quality" | "size" | "seeders">(INITIAL_FILTERS.sortBy);
  const [downloadQueued, setDownloadQueued] = useState(false);
  const [libraryMatch, setLibraryMatch] = useState<LibraryItem | null>(null);
  const processedLaunch = useRef(false);

  useEffect(() => {
    saveStreamFilters({ minRes, codec, maxSize, cachedOnly, minSeeders, sortBy });
  }, [minRes, codec, maxSize, cachedOnly, minSeeders, sortBy]);

  const applyStreamLaunch = async (launch: StreamLaunch) => {
    if (launch.source === "stremio") {
      const res = await api.browseOpen(launch.stremio_id, launch.media);
      if (res.action === "title") {
        setMode("search");
        await pickTitle(res.title, { fromBrowse: true });
      } else {
        setError("That link is a collection — open it from Browse first.");
      }
      return;
    }
    const params = decodeTmdbStreamOpen(launch.raw);
    if (!params) {
      setError("Invalid stream link.");
      return;
    }
    const d = await api.titleDetails(params.tmdb_id, params.type);
    setMode("search");
    await pickTitle(
      {
        tmdb_id: d.tmdb_id,
        type: params.type,
        title: d.title,
        year: d.year || "",
        overview: d.overview,
        poster: d.poster || "",
        rating: 0,
      },
      { fromBrowse: true, season: params.season, episode: params.episode }
    );
  };

  useEffect(() => {
    if (processedLaunch.current) return;

    const launch = initialStreamLaunch ?? readStreamLaunchFromLocation();
    if (!launch) return;

    processedLaunch.current = true;
    if (!initialStreamLaunch) clearStreamLaunchFromLocation();

    let cancelled = false;
    (async () => {
      try {
        await applyStreamLaunch(launch);
      } catch (err: unknown) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not open title");
        }
      } finally {
        if (!cancelled) onInitialStreamOpenHandled?.();
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialStreamLaunch]);

  const doSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    setSearching(true);
    setError("");
    setSelected(null);
    setStreams([]);
    try {
      setResults(await api.search(query.trim()));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSearching(false);
    }
  };

  const pickTitle = async (
    r: SearchResult,
    opts?: { fromBrowse?: boolean; season?: number; episode?: number }
  ) => {
    const fromBrowse = opts?.fromBrowse ?? false;
    if (!fromBrowse) setMode("search");
    setSelected(r);
    setStreams([]);
    setStreamsFetched(false);
    if (!fromBrowse) setResults([]);
    setSeasons([]);
    setSeason(opts?.season);
    setEpisode(opts?.episode);
    setEpisodes([]);
    setDownloadQueued(false);
    setLibraryMatch(null);
    setError("");

    if (r.type === "series") {
      try {
        const d = await api.titleDetails(r.tmdb_id, r.type);
        setSeasons(d.seasons || []);
        if (opts?.season != null) {
          setLoadingEpisodes(true);
          try {
            const epRes = await api.seasonEpisodes(r.tmdb_id, opts.season);
            setEpisodes(epRes.episodes);
          } catch {
            setEpisodes([]);
          } finally {
            setLoadingEpisodes(false);
          }
          if (opts.episode != null) {
            await loadStreams(r, opts.season, opts.episode);
          }
        }
      } catch {
        /* ignore */
      }
    } else {
      await loadStreams(r, undefined, undefined);
    }
  };

  useEffect(() => {
    if (!selected) {
      setLibraryMatch(null);
      return;
    }
    if (selected.type === "series" && season != null && episode == null) {
      setLibraryMatch(null);
      return;
    }
    const activeSeason = selected.type === "series" ? season : undefined;
    const activeEpisode = selected.type === "series" && season != null && episode != null ? episode : undefined;
    api
      .libraryMatch(selected.tmdb_id, selected.type, activeSeason, activeEpisode)
      .then((r) => setLibraryMatch(r.match))
      .catch(() => setLibraryMatch(null));
  }, [selected, season, episode]);

  const onSeasonChange = async (seasonNum: number) => {
    setSeason(seasonNum);
    setEpisode(undefined);
    setStreams([]);
    setEpisodes([]);
    if (!selected) return;
    setLoadingEpisodes(true);
    try {
      const r = await api.seasonEpisodes(selected.tmdb_id, seasonNum);
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

  const loadStreams = async (r: SearchResult, s?: number, ep?: number) => {
    const reqId = ++streamsRequest.current;
    setLoadingStreams(true);
    setStreamsFetched(true);
    setError("");
    setStreams([]);
    try {
      const res = await api.streams(r.tmdb_id, r.type, s, ep);
      if (reqId !== streamsRequest.current) return;
      setStreams(res.streams);
    } catch (err: unknown) {
      if (reqId !== streamsRequest.current) return;
      setError(err instanceof Error ? err.message : "Failed to load streams");
    } finally {
      if (reqId === streamsRequest.current) setLoadingStreams(false);
    }
  };

  const buildTitle = (s: StreamResult) =>
    `${selected?.title}${season ? ` S${season}E${episode}` : ""} [${s.resolution || "?"}]`;

  const currentLinkMeta = () => {
    if (!selected) return undefined;
    return downloadLinkMetaFromSearch(
      selected.tmdb_id,
      selected.type,
      season,
      episode
    );
  };

  const grabCached = async (s: StreamResult) => {
    try {
      await api.torrentDownload({ url: s.url, title: buildTitle(s), link: currentLinkMeta() });
      setGrabbed((prev) => new Set(prev).add(streamKey(s)));
      setDownloadQueued(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Download failed");
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
        title: buildTitle(s),
        link: currentLinkMeta(),
      });
      setGrabbed((prev) => new Set(prev).add(streamKey(s)));
      setDownloadQueued(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Cache & download failed");
    }
  };

  const manualTitle = () => {
    if (!selected) return "Title";
    return `${selected.title}${season && episode ? ` S${season}E${episode}` : ""}`;
  };

  const filtered = useMemo(
    () =>
      filterAndSortStreams(streams, {
        minRes,
        codec,
        maxSize,
        cachedOnly,
        minSeeders,
        sortBy,
      }),
    [streams, minRes, codec, maxSize, cachedOnly, minSeeders, sortBy]
  );

  const updateFilters = (patch: Partial<typeof INITIAL_FILTERS>) => {
    if (patch.minRes !== undefined) setMinRes(patch.minRes);
    if (patch.codec !== undefined) setCodec(patch.codec);
    if (patch.maxSize !== undefined) setMaxSize(patch.maxSize);
    if (patch.cachedOnly !== undefined) setCachedOnly(patch.cachedOnly);
    if (patch.minSeeders !== undefined) setMinSeeders(patch.minSeeders);
    if (patch.sortBy !== undefined) setSortBy(patch.sortBy);
  };

  return (
    <div className="min-w-0 space-y-5">
      <div className="flex gap-2 border-b border-white/5 pb-3">
        <button
          type="button"
          onClick={() => {
            setMode("search");
            setError("");
          }}
          className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${
            mode === "search" ? "bg-white/10 text-white" : "text-slate-400 hover:text-slate-200"
          }`}
        >
          <SearchIcon className="h-4 w-4" />
          Search
        </button>
        <button
          type="button"
          onClick={() => {
            setMode("browse");
            setSelected(null);
            setStreams([]);
            setError("");
          }}
          className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${
            mode === "browse" ? "bg-white/10 text-white" : "text-slate-400 hover:text-slate-200"
          }`}
        >
          <LayoutGrid className="h-4 w-4" />
          Browse
        </button>
      </div>

      {mode === "browse" && !selected && <Browse onPickTitle={(r) => pickTitle(r, { fromBrowse: true })} />}

      {mode === "search" && (
      <form onSubmit={doSearch} className="flex gap-2">
        <div className="relative flex-1">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search movies & shows (TMDB)…"
            className="input pl-10"
          />
        </div>
        <button type="submit" disabled={searching} className="btn-primary px-5">
          {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : "Search"}
        </button>
      </form>
      )}

      {error && <div className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</div>}

      {/* Title results */}
      {mode === "search" && !selected && results.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {results.map((r) => (
            <div key={`${r.type}-${r.tmdb_id}`} className={BROWSE_CARD}>
              <StreamOpenLink
                params={streamOpenFromSearchResult(r)}
                onOpenInPlace={() => pickTitle(r)}
                className="block w-full text-left"
              >
                <div className="aspect-[2/3] w-full bg-ink-800">
                  {r.poster ? (
                    <img src={r.poster} alt={r.title} className="h-full w-full object-cover" />
                  ) : (
                    <div className="grid h-full place-items-center text-slate-600">No image</div>
                  )}
                </div>
                <div className="p-2.5">
                  <div className="truncate text-sm font-medium">{r.title}</div>
                  <div className="mt-0.5 flex items-center justify-between text-xs text-slate-400">
                    <span>{r.year || "—"}</span>
                    <span className="flex items-center gap-1">
                      <Star className="h-3 w-3 text-amber-400" /> {r.rating?.toFixed(1)}
                    </span>
                  </div>
                  <span className="chip mt-1 bg-white/5 text-slate-400">{r.type}</span>
                </div>
              </StreamOpenLink>
              <div className="flex gap-1 border-t border-white/5 px-2 pb-2 pt-1">
                <AddToWatchlistButton
                  payload={{
                    kind: r.type === "series" ? "series" : "movie",
                    tmdb_id: r.tmdb_id,
                    media_type: r.type,
                    title: r.title,
                    poster: r.poster,
                    year: r.year,
                    overview: r.overview,
                  }}
                  label="Watchlist"
                  className="btn-ghost flex-1 justify-center py-1 text-[10px]"
                />
                {r.type === "movie" && (
                  <>
                    <StreamOpenLink
                      params={streamOpenFromSearchResult(r)}
                      onOpenInPlace={() => pickTitle(r)}
                      title="Middle-click or Ctrl+click to open in a new tab"
                      className="btn-primary flex-1 justify-center py-1 text-[10px]"
                    >
                      <Download className="h-3 w-3" /> Streams
                    </StreamOpenLink>
                    <StreamNewTabButton params={streamOpenFromSearchResult(r)} />
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Selected title -> streams */}
      {selected && (
        <div className="min-w-0">
          <button
            type="button"
            onClick={() => {
              streamsRequest.current += 1;
              setSelected(null);
              setStreams([]);
              setStreamsFetched(false);
            }}
            className="btn-ghost mb-4 text-xs"
          >
            ← {mode === "browse" ? "Back to browse" : "Back to results"}
          </button>
          <div className="mb-4 flex gap-4">
            {selected.poster && (
              <img src={selected.poster} alt="" className="h-28 w-20 rounded-lg object-cover" />
            )}
            <div className="flex-1">
              <h3 className="text-lg font-semibold">
                {selected.title} <span className="text-slate-500">{selected.year}</span>
              </h3>
              <p className="mt-1 line-clamp-3 max-w-xl text-sm text-slate-400">{selected.overview}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {libraryMatch && <InLibraryChip />}
                <TitleMediaActions libraryMatch={libraryMatch} />
                <AddToWatchlistButton
                  payload={{
                    kind: selected.type === "series" ? "series" : "movie",
                    tmdb_id: selected.tmdb_id,
                    media_type: selected.type,
                    title: selected.title,
                    poster: selected.poster,
                    year: selected.year,
                    overview: selected.overview,
                  }}
                />
                {selected.type === "movie" && (
                  <button
                    type="button"
                    disabled={loadingStreams}
                    onClick={() => loadStreams(selected, undefined, undefined)}
                    className="btn-primary text-xs"
                  >
                    {loadingStreams ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading torrents…
                      </>
                    ) : (
                      "Find streams"
                    )}
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Series season/episode picker */}
          {selected.type === "series" && (
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
                    <div
                      key={ep.episode_number}
                      className={`card flex gap-3 p-2 ${
                        episode === ep.episode_number ? "ring-1 ring-brand-500" : ""
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => pickEpisode(ep)}
                        className="flex min-w-0 flex-1 gap-3 text-left hover:opacity-90"
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
                          {ep.air_date && <div className="text-[10px] text-slate-500">{ep.air_date}</div>}
                          <p className="mt-0.5 line-clamp-2 text-[10px] text-slate-400">{ep.overview}</p>
                        </div>
                      </button>
                      {selected && season && (
                        <AddToWatchlistButton
                          payload={{
                            kind: "episode",
                            tmdb_id: selected.tmdb_id,
                            media_type: "series",
                            season,
                            episode: ep.episode_number,
                            title: `${selected.title} S${season}E${ep.episode_number} — ${ep.name}`,
                            poster: ep.still || selected.poster,
                            year: selected.year,
                            overview: ep.overview,
                            air_date: ep.air_date,
                          }}
                          label="Add"
                          className="btn-ghost shrink-0 self-start px-2 py-1 text-[10px]"
                        />
                      )}
                    </div>
                  ))}
                </div>
              )}

              {season && episode && (
                <button onClick={() => loadStreams(selected, season, episode)} className="btn-primary">
                  Find streams for S{season}E{episode}
                </button>
              )}
            </div>
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
              filters={{ minRes, codec, maxSize, cachedOnly, minSeeders, sortBy }}
              onFiltersChange={updateFilters}
            />
          )}

          {!loadingStreams && streamsFetched && streams.length === 0 && selected.type === "movie" && (
            <div className="py-6 text-center text-sm text-slate-500">No downloadable streams found.</div>
          )}

          {downloadQueued && selected && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-brand-500/30 bg-brand-500/5 p-4">
              <div>
                <p className="text-sm font-medium text-white">Added to download queue</p>
                <p className="text-xs text-slate-400">Save this title to your watchlist to track ratings and group progress.</p>
              </div>
              <AddToWatchlistButton
                payload={watchlistPayloadFromSearch(selected, season, episode)}
                label="Add to watchlist"
                className="btn-primary text-xs"
              />
            </div>
          )}

          <div className="mt-6">
            <ManualStreamForm
              title={manualTitle()}
              link={currentLinkMeta()}
              onError={setError}
              onQueued={() => setDownloadQueued(true)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
