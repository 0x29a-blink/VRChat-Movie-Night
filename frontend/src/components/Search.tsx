import { Loader2, Search as SearchIcon } from "lucide-react";
import { useToast } from "./Toast";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { AddToWatchlistButton } from "./AddToWatchlist";
import { Browse } from "./Browse";
import { downloadLinkMetaFromAnime, downloadLinkMetaFromSearch } from "./downloadLinkMeta";
import { watchlistPayloadFromSearch } from "./watchlistPayload";
import { InLibraryChip } from "./InLibraryChip";
import { ManualStreamForm } from "./ManualStreamForm";
import { StreamResultsPanel } from "./StreamFiltersPanel";
import { TitleMediaActions } from "./TitleMediaActions";
import { MediaSearchCard } from "./MediaSearchCard";
import type { LibraryItem, SearchResult, StreamResult, TmdbEpisode } from "../types";
import {
  clearStreamLaunchFromLocation,
  decodeTmdbStreamOpen,
  readStreamLaunchFromLocation,
  type StreamLaunch,
} from "../streamOpenUrl";
import { copyStreamDownloadLink, saveStreamToPc } from "../localDownload";
import { filterAndSortStreams, streamKey } from "../streamListUtils";
import { isAnimeStremioId, animeProviderLabel } from "../animeIds";
import { useStreamFilterState } from "../useStreamFilterState";
import { useSeasonEpisodeState } from "../useSeasonEpisodeState";

type MoviesMode = "search" | "browse";

type SeasonRow = { season_number: number; name: string; episode_count: number };

type MetadataProvider = {
  key: string;
  label: string;
  kind: "tmdb" | "anime";
  tmdb_id?: number;
};

function normalizeSeasons(rows: SeasonRow[]): SeasonRow[] {
  return rows
    .filter((s) => s.season_number > 0 && s.episode_count > 0)
    .map((s) => ({
      ...s,
      name: (s.name || "").trim() || `Season ${s.season_number}`,
    }));
}

function seasonOptionLabel(s: SeasonRow): string {
  return `${s.name} (${s.episode_count} eps)`;
}

function buildMetadataProviders(r: SearchResult, tmdbCandidates: SearchResult[]): MetadataProvider[] {
  const out: MetadataProvider[] = [];
  const seenTmdb = new Set<number>();
  if (r.stremio_id && isAnimeStremioId(r.stremio_id)) {
    out.push({
      key: `anime:${r.stremio_id}`,
      label: animeProviderLabel(r.stremio_id),
      kind: "anime",
    });
  }
  for (const hit of tmdbCandidates) {
    if (!hit.tmdb_id || hit.type !== "series" || seenTmdb.has(hit.tmdb_id)) continue;
    seenTmdb.add(hit.tmdb_id);
    out.push({
      key: `tmdb:${hit.tmdb_id}`,
      label: `TMDB — ${hit.title}${hit.year ? ` (${hit.year})` : ""}`,
      kind: "tmdb",
      tmdb_id: hit.tmdb_id,
    });
  }
  return out;
}

function pickDefaultMetadataKey(r: SearchResult, providers: MetadataProvider[]): string {
  if (!providers.length) return "";
  const year = (r.year || "").slice(0, 4);
  if (year) {
    const yearMatch = providers.find((p) => p.kind === "tmdb" && p.label.includes(`(${year})`));
    if (yearMatch) return yearMatch.key;
  }
  return providers.find((p) => p.kind === "tmdb")?.key ?? providers[0].key;
}

export function Search({
  initialStreamLaunch,
  onInitialStreamOpenHandled,
  allowLocalDownload = false,
  initialMode = "search",
  browseSource,
  autoOpenAnime = false,
  hideSourceToggle = false,
}: {
  initialStreamLaunch?: StreamLaunch | null;
  onInitialStreamOpenHandled?: () => void;
  allowLocalDownload?: boolean;
  // Plan 026 (Add Media flatten): Downloads.tsx now owns the top-level
  // Search|Browse|Anime|YouTube|M3U8 picker and remounts this component
  // (via `key`), so the internal Search/Browse toggle was deleted entirely
  // (plan 030 fix J) rather than kept behind a flag no consumer disables.
  initialMode?: MoviesMode;
  browseSource?: "collections" | "aiostreams";
  autoOpenAnime?: boolean;
  // Plan 030 (fix A): forwarded to Browse so its internal source switcher
  // doesn't desync from the top-level segment/URL.
  hideSourceToggle?: boolean;
}) {
  const { push: pushToast } = useToast();
  const [mode, setMode] = useState<MoviesMode>(initialMode);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState("");

  const [selected, setSelected] = useState<SearchResult | null>(null);
  const {
    seasons,
    setSeasons,
    season,
    setSeason,
    episode,
    setEpisode,
    episodes,
    setEpisodes,
    loadingEpisodes,
    setLoadingEpisodes,
  } = useSeasonEpisodeState();
  const [metadataProviders, setMetadataProviders] = useState<MetadataProvider[]>([]);
  const [activeMetadataKey, setActiveMetadataKey] = useState("");
  const metadataProvidersRef = useRef<MetadataProvider[]>([]);
  const activeMetadataKeyRef = useRef("");

  const syncMetadataLookup = (providers: MetadataProvider[], key: string) => {
    metadataProvidersRef.current = providers;
    activeMetadataKeyRef.current = key;
    setMetadataProviders(providers);
    setActiveMetadataKey(key);
  };

  const [streams, setStreams] = useState<StreamResult[]>([]);
  const [loadingStreams, setLoadingStreams] = useState(false);
  const [streamsFetched, setStreamsFetched] = useState(false);
  const [grabbed, setGrabbed] = useState<Set<string>>(new Set());
  const streamsRequest = useRef(0);
  const [downloadQueued, setDownloadQueued] = useState(false);
  const [libraryMatch, setLibraryMatch] = useState<LibraryItem | null>(null);
  const [activeVideoId, setActiveVideoId] = useState("");
  const processedLaunch = useRef(false);
  const { filters, updateFilters, presets, savePreset, applyPreset, deletePreset } = useStreamFilterState();
  const {
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
    indexer,
    releaseGroup,
  } = filters;

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
    setSearched(true);
    try {
      setResults(await api.search(query.trim()));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSearching(false);
    }
  };

  const isAnimeTitle = (r: SearchResult) =>
    Boolean(r.anime_native || isAnimeStremioId(r.stremio_id));

  const loadEpisodesForProvider = async (
    r: SearchResult,
    provider: MetadataProvider | undefined,
    seasonNum: number
  ) => {
    if (provider?.kind === "tmdb" && provider.tmdb_id) {
      return (await api.seasonEpisodes(provider.tmdb_id, seasonNum)).episodes;
    }
    if (provider?.kind === "anime" && r.stremio_id) {
      return (await api.animeSeasonEpisodes(r.stremio_id, seasonNum)).episodes;
    }
    if (r.tmdb_id) {
      return (await api.seasonEpisodes(r.tmdb_id, seasonNum)).episodes;
    }
    if (r.stremio_id) {
      return (await api.animeSeasonEpisodes(r.stremio_id, seasonNum)).episodes;
    }
    return [];
  };

  const applyMetadataProvider = async (
    r: SearchResult,
    providerKey: string,
    providers: MetadataProvider[],
    initialSeason?: number
  ) => {
    const provider = providers.find((p) => p.key === providerKey);
    if (!provider) return r;

    syncMetadataLookup(providers, providerKey);
    setSeason(undefined);
    setEpisode(undefined);
    setEpisodes([]);
    setStreams([]);
    setStreamsFetched(false);
    setActiveVideoId("");

    let enriched = r;
    let normalized: SeasonRow[] = [];

    if (provider.kind === "tmdb" && provider.tmdb_id) {
      enriched = { ...r, tmdb_id: provider.tmdb_id };
      setSelected(enriched);
      const d = await api.titleDetails(provider.tmdb_id, "series");
      normalized = normalizeSeasons(d.seasons || []);
    } else if (r.stremio_id) {
      const d = await api.animeMeta(r.stremio_id);
      normalized = normalizeSeasons(d.seasons || []);
      setSelected(enriched);
    }

    setSeasons(normalized);

    const pickSeason =
      initialSeason != null && normalized.some((s) => s.season_number === initialSeason)
        ? initialSeason
        : normalized[0]?.season_number;

    if (pickSeason != null) {
      setSeason(pickSeason);
      setLoadingEpisodes(true);
      try {
        setEpisodes(await loadEpisodesForProvider(enriched, provider, pickSeason));
      } catch {
        setEpisodes([]);
      } finally {
        setLoadingEpisodes(false);
      }
    }

    return enriched;
  };

  const selectInitialSeason = async (
    r: SearchResult,
    normalized: SeasonRow[],
    provider: MetadataProvider | undefined,
    initialSeason?: number,
    initialEpisode?: number
  ) => {
    setSeasons(normalized);
    const pickSeason =
      initialSeason != null && normalized.some((s) => s.season_number === initialSeason)
        ? initialSeason
        : normalized[0]?.season_number;
    if (pickSeason == null) return;

    setSeason(pickSeason);
    setLoadingEpisodes(true);
    try {
      const eps = await loadEpisodesForProvider(r, provider, pickSeason);
      setEpisodes(eps);
      if (initialEpisode != null) {
        setEpisode(initialEpisode);
        const ep = eps.find((e) => e.episode_number === initialEpisode);
        const videoId = ep?.video_stremio_id || "";
        if (videoId) setActiveVideoId(videoId);
        await loadStreams(r, pickSeason, initialEpisode, { episodeRows: eps, videoId });
      }
    } catch {
      setEpisodes([]);
    } finally {
      setLoadingEpisodes(false);
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
    setActiveVideoId("");
    setError("");
    syncMetadataLookup([], "");

    if (r.type === "series" && isAnimeTitle(r) && r.stremio_id) {
      try {
        let tmdbCandidates: SearchResult[] = [];
        try {
          const hits = await api.search(r.title);
          tmdbCandidates = hits.filter((h) => h.type === "series" && h.tmdb_id);
          if (r.tmdb_id && !tmdbCandidates.some((h) => h.tmdb_id === r.tmdb_id)) {
            tmdbCandidates.unshift({ ...r, type: "series" });
          }
        } catch {
          /* ignore TMDB search failure */
        }

        const providers = buildMetadataProviders(r, tmdbCandidates);

        if (providers.length) {
          const defaultKey = pickDefaultMetadataKey(r, providers);
          const enriched = await applyMetadataProvider(r, defaultKey, providers, opts?.season);
          if (opts?.season != null && opts.episode != null) {
            setEpisode(opts.episode);
            await loadStreams(enriched, opts.season, opts.episode);
          }
        } else {
          const d = await api.animeMeta(r.stremio_id);
          await selectInitialSeason(
            r,
            normalizeSeasons(d.seasons || []),
            undefined,
            opts?.season,
            opts?.episode
          );
        }
      } catch {
        setError("Could not load anime metadata from AIOStreams.");
      }
      return;
    }

    if (r.type === "series") {
      if (!r.tmdb_id && r.stremio_id) {
        await loadStreams(r, opts?.season, opts?.episode);
        return;
      }
      try {
        const d = await api.titleDetails(r.tmdb_id, r.type);
        await selectInitialSeason(
          r,
          normalizeSeasons(d.seasons || []),
          undefined,
          opts?.season,
          opts?.episode
        );
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
    if (isAnimeTitle(selected) && selected.stremio_id) {
      api
        .libraryMatch({
          mediaType: "series",
          stremioId: selected.stremio_id,
          season: activeSeason,
          episode: activeEpisode,
        })
        .then((r) => setLibraryMatch(r.match))
        .catch(() => setLibraryMatch(null));
      return;
    }
    if (!selected.tmdb_id) {
      setLibraryMatch(null);
      return;
    }
    api
      .libraryMatch({
        mediaType: selected.type,
        tmdbId: selected.tmdb_id,
        season: activeSeason,
        episode: activeEpisode,
      })
      .then((r) => setLibraryMatch(r.match))
      .catch(() => setLibraryMatch(null));
  }, [selected, season, episode]);

  const onSeasonChange = async (seasonNum: number) => {
    setSeason(seasonNum);
    setEpisode(undefined);
    setStreams([]);
    setEpisodes([]);
    setActiveVideoId("");
    if (!selected) return;
    setLoadingEpisodes(true);
    try {
      const provider = metadataProviders.find((p) => p.key === activeMetadataKey);
      setEpisodes(await loadEpisodesForProvider(selected, provider, seasonNum));
    } catch {
      setEpisodes([]);
    } finally {
      setLoadingEpisodes(false);
    }
  };

  const pickEpisode = (ep: TmdbEpisode) => {
    setEpisode(ep.episode_number);
    setActiveVideoId(ep.video_stremio_id || "");
    setStreams([]);
    setStreamsFetched(false);
  };

  const loadStreams = async (
    r: SearchResult,
    s?: number,
    ep?: number,
    lookup?: { episodeRows?: TmdbEpisode[]; videoId?: string }
  ) => {
    const reqId = ++streamsRequest.current;
    setLoadingStreams(true);
    setStreamsFetched(true);
    setError("");
    setStreams([]);
    try {
      let res;
      const provider = metadataProvidersRef.current.find((p) => p.key === activeMetadataKeyRef.current);
      const tmdbId = provider?.kind === "tmdb" ? provider.tmdb_id : r.tmdb_id;
      const useTmdb =
        provider?.kind === "tmdb" || (!provider && !isAnimeTitle(r)) || (!provider && r.tmdb_id && !r.stremio_id);
      const episodeRows = lookup?.episodeRows ?? episodes;
      const videoId = lookup?.videoId ?? activeVideoId;

      if (useTmdb && tmdbId && (s != null && ep != null || !isAnimeTitle(r))) {
        res = await api.streams(tmdbId, r.type, s, ep);
      } else if (isAnimeTitle(r) && r.stremio_id) {
        const epRow = episodeRows.find((e) => e.episode_number === ep);
        const resolvedVideoId = videoId || epRow?.video_stremio_id || "";
        if (!resolvedVideoId && s != null && ep != null) {
          throw new Error("No episode video id from AIOStreams meta — pick an episode again.");
        }
        res = await api.streamsStremio(resolvedVideoId, r.stremio_id, s, ep);
      } else if (tmdbId) {
        res = await api.streams(tmdbId, r.type, s, ep);
      } else if (r.stremio_id) {
        res = await api.streamsStremio(r.stremio_id, r.stremio_id, s, ep);
      } else {
        throw new Error("No metadata source available for streams.");
      }
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
    if (isAnimeTitle(selected) && selected.stremio_id) {
      return downloadLinkMetaFromAnime(selected, season, episode);
    }
    if (!selected.tmdb_id) return undefined;
    return downloadLinkMetaFromSearch(selected.tmdb_id, selected.type, season, episode);
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

  const manualTitle = () => {
    if (!selected) return "Title";
    return `${selected.title}${season && episode ? ` S${season}E${episode}` : ""}`;
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
        indexer,
        releaseGroup,
      }),
    [
      streams,
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
      indexer,
      releaseGroup,
    ]
  );

  return (
    <div className="min-w-0 space-y-5">
      {mode === "browse" && (
        <div className={selected ? "hidden" : undefined}>
          <Browse
            onPickTitle={(r) => pickTitle(r, { fromBrowse: true })}
            allowLocalDownload={allowLocalDownload}
            initialSource={browseSource}
            autoOpenAnime={autoOpenAnime}
            hideSourceToggle={hideSourceToggle}
          />
        </div>
      )}

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
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {results.map((r) => (
            <MediaSearchCard key={`${r.type}-${r.tmdb_id}-${r.title}`} result={r} onOpen={() => pickTitle(r)} />
          ))}
        </div>
      )}

      {mode === "search" && !selected && searched && !searching && !error && results.length === 0 && (
        <div className="rounded-lg border border-dashed border-white/10 px-4 py-8 text-center text-sm text-slate-500">
          No titles found. Try adding the release year, checking the original title, or switching to Browse.
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
              syncMetadataLookup([], "");
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
                {selected.title}{" "}
                {isAnimeTitle(selected) && (
                  <span className="chip bg-violet-500/15 text-violet-300">AIOStreams</span>
                )}{" "}
                <span className="text-slate-500">{selected.year}</span>
              </h3>
              <p className="mt-1 line-clamp-3 max-w-xl text-sm text-slate-400">{selected.overview}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {libraryMatch && <InLibraryChip />}
                <TitleMediaActions libraryMatch={libraryMatch} />
                <AddToWatchlistButton
                  payload={watchlistPayloadFromSearch(selected)}
                  label={selected.type === "series" ? "Add series" : "Add to watchlist"}
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
              {metadataProviders.length > 1 && (
                <label className="block text-xs text-slate-400">
                  Metadata provider
                  <select
                    className="input mt-1 w-full max-w-md"
                    value={activeMetadataKey}
                    onChange={(e) => {
                      if (!selected) return;
                      void applyMetadataProvider(selected, e.target.value, metadataProviders);
                    }}
                  >
                    {metadataProviders.map((p) => (
                      <option key={p.key} value={p.key}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              <label className="text-xs text-slate-400">
                Season
                <select
                  className="input mt-1 w-48"
                  value={season ?? ""}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    if (n) onSeasonChange(n);
                  }}
                  disabled={seasons.length === 0}
                >
                  {seasons.length === 0 ? (
                    <option value="">Loading seasons…</option>
                  ) : (
                    seasons.map((s) => (
                      <option key={s.season_number} value={s.season_number}>
                        {seasonOptionLabel(s)}
                      </option>
                    ))
                  )}
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
                      {selected && season != null && (
                        <AddToWatchlistButton
                          payload={watchlistPayloadFromSearch(
                            selected,
                            season,
                            ep.episode_number,
                            ep
                          )}
                          label="Add ep"
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
                indexer,
                releaseGroup,
              }}
              onFiltersChange={updateFilters}
              presets={presets}
              onApplyPreset={applyPreset}
              onSavePreset={savePreset}
              onDeletePreset={deletePreset}
            />
          )}

          {!loadingStreams && streamsFetched && streams.length === 0 && (
            <div className="rounded-lg border border-dashed border-white/10 px-4 py-6 text-center text-sm text-slate-500">
              <p>No downloadable streams found for {selected.title}.</p>
              <p className="mt-1 text-xs">
                Try another season or episode, adjust filters, or check that AIOStreams is configured in Settings.
              </p>
            </div>
          )}

          {downloadQueued && selected && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-brand-500/30 bg-brand-500/5 p-4">
              <div>
                <p className="text-sm font-medium text-white">Added to download queue</p>
                <p className="text-xs text-slate-400">Save this title to your watchlist to track ratings and group progress.</p>
              </div>
              <AddToWatchlistButton
                payload={
                  watchlistPayloadFromSearch(
                    selected,
                    season,
                    episode,
                    episodes.find((e) => e.episode_number === episode)
                  ) ?? watchlistPayloadFromSearch(selected)
                }
                label={season != null && episode != null ? "Add episode" : "Add to watchlist"}
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
