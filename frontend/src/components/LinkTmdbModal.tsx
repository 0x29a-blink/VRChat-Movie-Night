import { Film, Loader2, Search as SearchIcon, Tv, X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../api";
import type { LibraryItem, SearchResult, TmdbEpisode } from "../types";
import { libraryLinkLabel } from "./libraryWatchlist";

type LinkMode = "link" | "relink";

type CurrentLinkInfo = {
  title: string;
  year: string;
  overview: string;
  poster: string;
  type: "movie" | "series";
  seasons: { season_number: number; name: string; episode_count: number }[];
  episodeLabel?: string;
};

function CurrentLinkPanel({
  item,
  info,
  loading,
  error,
}: {
  item: LibraryItem;
  info: CurrentLinkInfo | null;
  loading: boolean;
  error: string;
}) {
  const badge = libraryLinkLabel(item);

  return (
    <div className="flex min-h-0 flex-col rounded-xl border border-white/10 bg-white/[0.02] p-3">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Current link</div>
      {loading ? (
        <div className="flex flex-1 items-center justify-center gap-2 py-8 text-sm text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : error ? (
        <p className="mt-3 text-sm text-red-300">{error}</p>
      ) : info ? (
        <div className="mt-3 min-h-0 flex-1 space-y-3 overflow-y-auto">
          <div className="flex gap-3">
            {info.poster ? (
              <img src={info.poster} alt="" className="h-24 w-16 shrink-0 rounded-lg object-cover" />
            ) : (
              <div className="grid h-24 w-16 shrink-0 place-items-center rounded-lg bg-white/5 text-slate-500">
                {info.type === "movie" ? <Film className="h-5 w-5" /> : <Tv className="h-5 w-5" />}
              </div>
            )}
            <div className="min-w-0">
              <div className="font-medium text-white">{info.title}</div>
              <div className="mt-0.5 text-xs text-slate-400">
                {info.year || "—"} · {info.type === "movie" ? "Movie" : "Series"}
              </div>
              {badge && (
                <span className="chip mt-1.5 bg-brand-500/15 text-brand-300">{badge}</span>
              )}
            </div>
          </div>
          {info.episodeLabel && (
            <p className="text-xs text-slate-400">
              Linked episode: <span className="text-slate-200">{info.episodeLabel}</span>
            </p>
          )}
          {info.overview && (
            <p className="line-clamp-4 text-xs text-slate-400">{info.overview}</p>
          )}
          {info.type === "series" && info.seasons.length > 0 && (
            <div>
              <div className="text-[11px] font-medium text-slate-500">Seasons on record</div>
              <ul className="mt-1 space-y-0.5 text-xs text-slate-400">
                {info.seasons.map((s) => (
                  <li key={s.season_number}>
                    {s.name || `Season ${s.season_number}`} ({s.episode_count} eps)
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="truncate text-[10px] text-slate-600" title={item.filename}>
            File: {item.filename}
          </p>
        </div>
      ) : null}
    </div>
  );
}

function PickLinkPanel({
  item,
  query,
  setQuery,
  searching,
  doSearch,
  error,
  setError,
  results,
  selected,
  pickTitle,
  seasons,
  season,
  setSeason,
  episodes,
  episode,
  setEpisode,
  loadingEpisodes,
  busy,
  link,
  mode,
  setSelected,
}: {
  item: LibraryItem;
  query: string;
  setQuery: (v: string) => void;
  searching: boolean;
  doSearch: (e?: React.FormEvent) => void;
  error: string;
  setError: (v: string) => void;
  results: SearchResult[];
  selected: SearchResult | null;
  setSelected: (v: SearchResult | null) => void;
  pickTitle: (r: SearchResult) => void;
  seasons: { season_number: number; name: string; episode_count: number }[];
  season: number | undefined;
  setSeason: (v: number | undefined) => void;
  episodes: TmdbEpisode[];
  episode: number | undefined;
  setEpisode: (v: number | undefined) => void;
  loadingEpisodes: boolean;
  busy: boolean;
  link: (opts: {
    tmdb_id: number;
    media_type: "movie" | "series";
    season?: number;
    episode?: number;
  }) => void;
  mode: LinkMode;
}) {
  return (
    <div className="flex min-h-0 flex-col rounded-xl border border-brand-500/20 bg-brand-500/[0.03] p-3">
      <div className="text-xs font-medium uppercase tracking-wide text-brand-300">
        {mode === "relink" ? "Pick new link" : "Search TMDB"}
      </div>
      <p className="mt-1 truncate text-[10px] text-slate-500">{item.title}</p>

      <form onSubmit={doSearch} className="mt-3 flex gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search movies & series…"
          className="input flex-1 text-sm"
        />
        <button type="submit" disabled={searching} className="btn-primary shrink-0">
          {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <SearchIcon className="h-4 w-4" />}
        </button>
      </form>

      {error && <p className="mt-3 text-sm text-red-300">{error}</p>}

      {!selected && results.length > 0 && (
        <ul className="mt-3 max-h-48 space-y-2 overflow-y-auto">
          {results.map((r) => (
            <li key={`${r.type}-${r.tmdb_id}`}>
              <button
                type="button"
                onClick={() => pickTitle(r)}
                className="flex w-full gap-3 rounded-xl border border-white/5 bg-white/[0.02] p-2 text-left hover:bg-white/[0.05]"
              >
                {r.poster ? (
                  <img src={r.poster} alt="" className="h-14 w-10 shrink-0 rounded object-cover" />
                ) : (
                  <div className="grid h-14 w-10 shrink-0 place-items-center rounded bg-white/5 text-slate-500">
                    {r.type === "movie" ? <Film className="h-4 w-4" /> : <Tv className="h-4 w-4" />}
                  </div>
                )}
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-white">{r.title}</div>
                  <div className="text-xs text-slate-500">
                    {r.year} · {r.type === "movie" ? "Movie" : "Series"}
                  </div>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}

      {selected && (
        <div className="mt-3 min-h-0 flex-1 space-y-3 overflow-y-auto">
          <div className="flex gap-3 rounded-xl border border-brand-500/30 bg-brand-500/5 p-3">
            {selected.poster ? (
              <img src={selected.poster} alt="" className="h-16 w-11 shrink-0 rounded object-cover" />
            ) : null}
            <div className="min-w-0 flex-1">
              <div className="font-medium text-white">{selected.title}</div>
              <div className="text-xs text-slate-400">
                {selected.year} · {selected.type === "movie" ? "Movie" : "Series"}
              </div>
              {selected.overview && (
                <p className="mt-1 line-clamp-3 text-[11px] text-slate-500">{selected.overview}</p>
              )}
              <button
                type="button"
                onClick={() => {
                  setSelected(null);
                  setSeason(undefined);
                  setEpisode(undefined);
                }}
                className="mt-1 text-[11px] text-brand-300 hover:underline"
              >
                Pick a different title
              </button>
            </div>
          </div>

          {selected.type === "movie" ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => link({ tmdb_id: selected.tmdb_id, media_type: "movie" })}
              className="btn-primary w-full"
            >
              {mode === "relink" ? "Relink as movie" : "Link as movie"}
            </button>
          ) : (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={() => link({ tmdb_id: selected.tmdb_id, media_type: "series" })}
                className="btn-ghost w-full border border-white/10"
              >
                {mode === "relink" ? "Relink as whole series" : "Link as whole series"}
              </button>

              <div className="rounded-xl border border-white/5 p-3">
                <p className="text-xs font-medium text-slate-400">Or link to a specific episode</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <select
                    value={season ?? ""}
                    onChange={(e) => setSeason(e.target.value ? Number(e.target.value) : undefined)}
                    className="input !w-auto !py-1.5 text-sm"
                  >
                    <option value="">Season</option>
                    {seasons.map((s) => (
                      <option key={s.season_number} value={s.season_number}>
                        {s.name || `Season ${s.season_number}`}
                      </option>
                    ))}
                  </select>
                </div>

                {season != null && (
                  <div className="mt-3 max-h-36 overflow-y-auto">
                    {loadingEpisodes ? (
                      <Loader2 className="h-4 w-4 animate-spin text-slate-500" />
                    ) : episodes.length === 0 ? (
                      <p className="text-xs text-slate-500">No episodes found.</p>
                    ) : (
                      <ul className="space-y-1">
                        {episodes.map((ep) => (
                          <li key={ep.episode_number}>
                            <button
                              type="button"
                              onClick={() => setEpisode(ep.episode_number)}
                              className={`flex w-full gap-2 rounded-lg px-2 py-1.5 text-left text-xs ${
                                episode === ep.episode_number
                                  ? "bg-brand-500/20 text-white"
                                  : "hover:bg-white/5 text-slate-300"
                              }`}
                            >
                              <span className="shrink-0 font-mono text-slate-500">E{ep.episode_number}</span>
                              <span className="truncate">{ep.name || `Episode ${ep.episode_number}`}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}

                <button
                  type="button"
                  disabled={busy || season == null || episode == null}
                  onClick={() =>
                    link({
                      tmdb_id: selected.tmdb_id,
                      media_type: "series",
                      season,
                      episode,
                    })
                  }
                  className="btn-primary mt-3 w-full"
                >
                  {mode === "relink" ? "Relink episode" : "Link episode"}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function LinkTmdbModal({
  item,
  mode = "link",
  onClose,
  onLinked,
}: {
  item: LibraryItem;
  mode?: LinkMode;
  onClose: () => void;
  onLinked: (updated: LibraryItem) => void;
}) {
  const [query, setQuery] = useState(item.tmdb_title || item.title);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");

  const [selected, setSelected] = useState<SearchResult | null>(null);
  const [seasons, setSeasons] = useState<{ season_number: number; name: string; episode_count: number }[]>([]);
  const [season, setSeason] = useState<number | undefined>();
  const [episodes, setEpisodes] = useState<TmdbEpisode[]>([]);
  const [episode, setEpisode] = useState<number | undefined>();
  const [loadingEpisodes, setLoadingEpisodes] = useState(false);
  const [busy, setBusy] = useState(false);

  const [currentInfo, setCurrentInfo] = useState<CurrentLinkInfo | null>(null);
  const [loadingCurrent, setLoadingCurrent] = useState(mode === "relink");
  const [currentError, setCurrentError] = useState("");

  useEffect(() => {
    if (mode !== "relink" || !item.linked) return;
    let cancelled = false;
    setLoadingCurrent(true);
    setCurrentError("");

    (async () => {
      try {
        const sid = (item.stremio_id || "").trim();
        if (sid && (sid.startsWith("kitsu:") || sid.startsWith("mal:") || sid.startsWith("anilist:"))) {
          const d = await api.animeMeta(sid);
          const episodeLabel =
            item.season != null && item.episode != null
              ? `S${item.season}E${item.episode}${item.episode_title ? ` — ${item.episode_title}` : ""}`
              : undefined;
          if (!cancelled) {
            setCurrentInfo({
              title: d.title?.title || item.tmdb_title || item.title,
              year: d.title?.year || item.tmdb_year || "",
              overview: d.title?.overview || "",
              poster: item.poster || d.title?.poster || "",
              type: "series",
              seasons: d.seasons || [],
              episodeLabel,
            });
          }
        } else if (item.tmdb_id && item.media_type) {
          const d = await api.titleDetails(item.tmdb_id, item.media_type);
          const episodeLabel =
            item.season != null && item.episode != null
              ? `S${item.season}E${item.episode}${item.episode_title ? ` — ${item.episode_title}` : ""}`
              : undefined;
          if (!cancelled) {
            setCurrentInfo({
              title: d.title || item.tmdb_title || item.title,
              year: d.year || item.tmdb_year || "",
              overview: d.overview || "",
              poster: item.poster || d.poster || "",
              type: item.media_type,
              seasons: d.seasons || [],
              episodeLabel,
            });
          }
        } else {
          if (!cancelled) {
            setCurrentInfo({
              title: item.tmdb_title || item.title,
              year: item.tmdb_year || "",
              overview: "",
              poster: item.poster || "",
              type: item.media_type === "movie" ? "movie" : "series",
              seasons: [],
            });
          }
        }
      } catch (err: unknown) {
        if (!cancelled) {
          setCurrentError(err instanceof Error ? err.message : "Could not load current link");
        }
      } finally {
        if (!cancelled) setLoadingCurrent(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [mode, item]);

  const doSearch = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!query.trim()) return;
    setSearching(true);
    setError("");
    setSelected(null);
    setSeasons([]);
    setSeason(undefined);
    setEpisodes([]);
    setEpisode(undefined);
    try {
      setResults(await api.search(query.trim()));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Search failed");
    } finally {
      setSearching(false);
    }
  };

  const pickTitle = async (r: SearchResult) => {
    setSelected(r);
    setSeason(undefined);
    setEpisode(undefined);
    setEpisodes([]);
    if (r.type === "series") {
      try {
        const d = await api.titleDetails(r.tmdb_id, r.type);
        setSeasons(d.seasons || []);
      } catch {
        setSeasons([]);
      }
    }
  };

  useEffect(() => {
    if (season == null || !selected) return;
    setLoadingEpisodes(true);
    setEpisode(undefined);
    api
      .seasonEpisodes(selected.tmdb_id, season)
      .then((r) => setEpisodes(r.episodes))
      .catch(() => setEpisodes([]))
      .finally(() => setLoadingEpisodes(false));
  }, [season, selected?.tmdb_id]);

  const link = async (opts: {
    tmdb_id: number;
    media_type: "movie" | "series";
    season?: number;
    episode?: number;
  }) => {
    setBusy(true);
    setError("");
    try {
      const updated = await api.linkLibraryItem(item.id, opts);
      onLinked(updated);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Link failed");
    } finally {
      setBusy(false);
    }
  };

  const pickPanelProps = {
    item,
    query,
    setQuery,
    searching,
    doSearch,
    error,
    setError,
    results,
    selected,
    setSelected,
    pickTitle,
    seasons,
    season,
    setSeason,
    episodes,
    episode,
    setEpisode,
    loadingEpisodes,
    busy,
    link,
    mode,
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className={`card flex max-h-[90vh] w-full flex-col ${mode === "relink" ? "max-w-4xl" : "max-w-lg"}`}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-white/10 p-4">
          <div className="min-w-0">
            <h3 className="font-semibold text-white">
              {mode === "relink" ? "Relink to TMDB" : "Link to TMDB"}
            </h3>
            <p className="mt-1 text-[11px] text-slate-500">
              {mode === "relink"
                ? "Compare the current link with a new title side by side, then confirm the relink."
                : "Match this file to a movie, series, or specific episode for poster art and watchlist metadata."}
            </p>
          </div>
          <button type="button" onClick={onClose} className="btn-ghost shrink-0 p-2">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {mode === "relink" ? (
            <div className="grid min-h-[320px] gap-4 lg:grid-cols-2">
              <CurrentLinkPanel
                item={item}
                info={currentInfo}
                loading={loadingCurrent}
                error={currentError}
              />
              <PickLinkPanel {...pickPanelProps} />
            </div>
          ) : (
            <PickLinkPanel {...pickPanelProps} />
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
