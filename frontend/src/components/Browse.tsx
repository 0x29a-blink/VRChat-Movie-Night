import { Check, Download, FolderOpen, HardDriveDownload, Layers, Loader2, Search, Sparkles } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { saveBrowseTorboxItemToPc } from "../localDownload";
import { useToast } from "./Toast";
import { isAnimeStremioId } from "../animeIds";
import { AddToWatchlistButton, type WatchlistAddPayload } from "./AddToWatchlist";
import { StreamOpenLink, BROWSE_CARD } from "./StreamOpenLink";
import type { BrowseItem, CatalogInfo, SearchResult, TmdbCollectionSummary } from "../types";
import { streamOpenFromBrowseItem, streamOpenFromSearchResult, type StreamOpenParams } from "../streamOpenUrl";

type CollectionView = {
  collection_id: number;
  name: string;
  overview: string;
  poster: string;
  movies: SearchResult[];
};

const COLLECTION_PRESETS = [
  "Marvel",
  "Star Wars",
  "Harry Potter",
  "Lord of the Rings",
  "Fast and Furious",
  "James Bond",
];

type BrowseSource = "collections" | "aiostreams";

type TitleGridRow = {
  key: string;
  title: string;
  year: string;
  poster: string;
  rating: number;
  badge?: string;
  watchlist?: WatchlistAddPayload;
  openParams?: StreamOpenParams;
  onOpen: () => void;
  onTorboxDownload?: () => void;
  torboxDownloadBusy?: boolean;
};

function watchlistFromSearchResult(m: SearchResult): WatchlistAddPayload {
  return {
    kind: m.type === "series" ? "series" : "movie",
    tmdb_id: m.tmdb_id,
    media_type: m.type,
    title: m.title,
    poster: m.poster,
    year: m.year,
    overview: m.overview,
  };
}

function watchlistFromCollection(c: {
  collection_id: number;
  name: string;
  overview?: string;
  poster?: string;
}): WatchlistAddPayload {
  return {
    kind: "collection",
    tmdb_id: c.collection_id,
    media_type: "collection",
    title: c.name,
    poster: c.poster || "",
    overview: c.overview || "",
  };
}

function watchlistFromBrowseItem(item: BrowseItem): WatchlistAddPayload | null {
  if (item.kind === "collection") {
    const sid = (item.stremio_id || "").trim();
    let collectionId: number | undefined;
    if (sid.startsWith("tmdb:")) {
      const n = Number(sid.split(":", 2)[1]);
      if (Number.isFinite(n)) collectionId = n;
    } else if (/^\d+$/.test(sid)) {
      collectionId = Number(sid);
    }
    if (!collectionId) return null;
    return watchlistFromCollection({
      collection_id: collectionId,
      name: item.title,
      overview: item.overview,
      poster: item.poster,
    });
  }
  const sid = (item.stremio_id || "").trim();
  let tmdbId: number | undefined;
  if (sid.startsWith("tmdb:")) {
    const n = Number(sid.split(":", 2)[1]);
    if (Number.isFinite(n)) tmdbId = n;
  } else if (/^\d+$/.test(sid)) {
    tmdbId = Number(sid);
  }
  if (!tmdbId) return null;
  const mediaType = item.type === "series" ? "series" : "movie";
  return {
    kind: mediaType === "series" ? "series" : "movie",
    tmdb_id: tmdbId,
    media_type: mediaType,
    title: item.title,
    poster: item.poster,
    year: item.year,
    overview: item.overview,
  };
}

function catalogKey(c: CatalogInfo) {
  return `${c.type}:${c.id}`;
}

function isTorboxLibraryCatalog(cat: CatalogInfo | null): boolean {
  if (!cat) return false;
  const id = (cat.id || "").toLowerCase();
  const name = (cat.name || "").toLowerCase();
  if (id.includes("library")) return true;
  if (name.includes("library") && (id.includes("torbox") || name.includes("torbox"))) return true;
  return name === "library" || name === "my library" || name === "torbox library";
}

function isGenreExtra(name: string) {
  return name.trim().toLowerCase() === "genre";
}

function defaultCatalogExtras(cat: CatalogInfo | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cat) return out;
  for (const extra of visibleCatalogExtras(cat)) {
    const name = extra.name || "";
    if (isGenreExtra(name) || !extra.required) {
      out[name] = "";
    } else if (extra.options?.length) {
      out[name] = extra.options[0];
    }
  }
  return out;
}

function visibleCatalogExtras(cat: CatalogInfo) {
  return cat.extras.filter((extra) => {
    const name = (extra.name || "").trim().toLowerCase();
    return name !== "skip" && name !== "search";
  });
}

function CatalogExtrasPanel({
  catalog,
  values,
  onChange,
  onApply,
  loading,
  inline = false,
}: {
  catalog: CatalogInfo;
  values: Record<string, string>;
  onChange: (name: string, value: string) => void;
  onApply: () => void;
  loading: boolean;
  inline?: boolean;
}) {
  if (!catalog.extras.length) return null;
  const extras = visibleCatalogExtras(catalog);
  if (!extras.length) return null;
  return (
    <div className={inline ? "space-y-3" : "card space-y-3 p-4"}>
      <div className="text-xs font-medium text-slate-300">Catalog options</div>
      <div className={`grid gap-3 ${inline ? "" : "sm:grid-cols-2"}`}>
        {extras.map((extra) => (
          <label key={extra.name} className="block text-xs text-slate-400">
            {extra.name}
            {extra.required ? " *" : ""}
            <select
              className="input mt-1"
              value={values[extra.name] ?? ""}
              onChange={(e) => onChange(extra.name, e.target.value)}
            >
              {(!extra.required || isGenreExtra(extra.name)) && <option value="">All</option>}
              {extra.options.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      <button type="button" onClick={onApply} disabled={loading} className="btn-primary text-xs">
        Apply filters
      </button>
    </div>
  );
}

function CatalogPicker({
  catalogs,
  selectedKey,
  onSelect,
  filter,
  onFilterChange,
}: {
  catalogs: CatalogInfo[];
  selectedKey: string;
  onSelect: (key: string) => void;
  filter: string;
  onFilterChange: (value: string) => void;
}) {
  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return catalogs;
    return catalogs.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.id.toLowerCase().includes(q) ||
        c.type.toLowerCase().includes(q)
    );
  }, [catalogs, filter]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-slate-400">Catalog</span>
        <span className="text-[11px] text-slate-500">
          {filtered.length === catalogs.length
            ? `${catalogs.length} total`
            : `${filtered.length} of ${catalogs.length}`}
        </span>
      </div>
      <div className="relative max-w-xl">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
        <input
          type="search"
          value={filter}
          onChange={(e) => onFilterChange(e.target.value)}
          placeholder="Filter catalogs…"
          className="input py-2 pl-9 text-sm"
        />
      </div>
      <div className="card max-h-52 overflow-y-auto rounded-xl border border-white/10 p-1">
        {filtered.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-slate-500">No catalogs match your filter.</p>
        ) : (
          filtered.map((c) => {
            const key = catalogKey(c);
            const active = key === selectedKey;
            return (
              <button
                key={key}
                type="button"
                onClick={() => onSelect(key)}
                className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm transition-colors ${
                  active
                    ? "bg-brand-500/15 text-white ring-1 ring-brand-500/40"
                    : "text-slate-300 hover:bg-white/5"
                }`}
              >
                <span className="chip w-14 shrink-0 justify-center bg-white/5 text-slate-400">
                  {c.type}
                </span>
                <span className="min-w-0 flex-1 truncate font-medium">{c.name}</span>
                {active && <Check className="h-4 w-4 shrink-0 text-brand-400" />}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

function TitleCardBody({ row }: { row: TitleGridRow }) {
  return (
    <>
      <div className="aspect-[2/3] w-full bg-ink-800">
        {row.poster ? (
          <img src={row.poster} alt={row.title} className="h-full w-full object-cover" />
        ) : (
          <div className="grid h-full place-items-center text-slate-600">No image</div>
        )}
      </div>
      <div className="p-2.5">
        <div className="truncate text-sm font-medium">{row.title}</div>
        <div className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-400">
          {row.badge && <span className="chip bg-brand-500/15 text-brand-300">{row.badge}</span>}
          <span>{row.year || "—"}</span>
        </div>
      </div>
    </>
  );
}

function TitleOpenTarget({
  row,
  resolving,
  children,
}: {
  row: TitleGridRow;
  resolving: boolean;
  children: ReactNode;
}) {
  if (row.openParams) {
    return (
      <StreamOpenLink
        params={row.openParams}
        onOpenInPlace={row.onOpen}
        disabled={resolving}
        className="block w-full text-left no-underline text-inherit"
      >
        {children}
      </StreamOpenLink>
    );
  }

  return (
    <button type="button" onClick={row.onOpen} disabled={resolving} className="block w-full text-left">
      {children}
    </button>
  );
}

function TitleCardActions({ row, resolving }: { row: TitleGridRow; resolving: boolean }) {
  if (!row.openParams && !row.onTorboxDownload) return null;

  return (
    <div
      className={`grid gap-1 border-t border-white/5 p-2 ${
        row.onTorboxDownload && row.openParams ? "grid-cols-2" : "grid-cols-1"
      }`}
    >
      {row.onTorboxDownload && (
        <button
          type="button"
          disabled={!!row.torboxDownloadBusy || resolving}
          onClick={(e) => {
            e.stopPropagation();
            row.onTorboxDownload?.();
          }}
          className="btn-ghost col-span-full min-w-0 justify-center gap-1 py-1.5 text-[10px] text-sky-300"
          title="Open TorBox CDN link in browser (already on your TorBox account)"
        >
          {row.torboxDownloadBusy ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <HardDriveDownload className="h-3 w-3" />
          )}
          TorBox download
        </button>
      )}
      {row.openParams && (
        <>
          {row.watchlist ? (
            <AddToWatchlistButton
              payload={row.watchlist}
              label="Watchlist"
              className="btn-ghost min-w-0 justify-center py-1 text-[10px]"
            />
          ) : (
            <div />
          )}
          <StreamOpenLink
            params={row.openParams}
            onOpenInPlace={row.onOpen}
            disabled={resolving}
            title="Middle-click or Ctrl+click to open in a new tab"
            className="btn-primary min-w-0 justify-center gap-1 py-1 text-[10px] no-underline"
          >
            <Download className="h-3 w-3 shrink-0" /> Streams
          </StreamOpenLink>
        </>
      )}
    </div>
  );
}

function TitleGrid({ rows, resolving }: { rows: TitleGridRow[]; resolving: boolean }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {rows.map((row) => (
        <div key={row.key} className={BROWSE_CARD}>
          <TitleOpenTarget row={row} resolving={resolving}>
            <TitleCardBody row={row} />
          </TitleOpenTarget>
          <TitleCardActions row={row} resolving={resolving} />
        </div>
      ))}
    </div>
  );
}

function titleRowsFromSearchResults(
  movies: SearchResult[],
  onPickTitle: (result: SearchResult) => void
): TitleGridRow[] {
  return movies.map((movie) => ({
    key: `m-${movie.tmdb_id}`,
    title: movie.title,
    year: movie.year,
    poster: movie.poster,
    rating: movie.rating,
    openParams: streamOpenFromSearchResult(movie),
    watchlist: watchlistFromSearchResult(movie),
    onOpen: () => onPickTitle(movie),
  }));
}

export function Browse({
  onPickTitle,
  allowLocalDownload = false,
  initialSource = "collections",
  autoOpenAnime = false,
  hideSourceToggle = false,
}: {
  onPickTitle: (r: SearchResult) => void;
  allowLocalDownload?: boolean;
  // Plan 026 (Add Media flatten): let the coordinator (Downloads.tsx) land
  // directly on a source, e.g. Anime, without the user re-clicking here.
  initialSource?: BrowseSource;
  autoOpenAnime?: boolean;
  // Plan 030 (fix A): when the top-level segment already pins the source
  // (Downloads.tsx's Browse/Anime segments), hide this internal switcher so
  // it can't desync from the URL/segment.
  hideSourceToggle?: boolean;
}) {
  const { push: pushToast } = useToast();
  const [source, setSource] = useState<BrowseSource>(initialSource);
  const [error, setError] = useState("");
  const [torboxDownloadBusy, setTorboxDownloadBusy] = useState<string | null>(null);

  // TMDB collections
  const [collQuery, setCollQuery] = useState("");
  const [collections, setCollections] = useState<TmdbCollectionSummary[]>([]);
  const [loadingColl, setLoadingColl] = useState(false);
  const [activeCollection, setActiveCollection] = useState<CollectionView | null>(null);
  const [activeAioCollection, setActiveAioCollection] = useState<CollectionView | null>(null);

  // AIOStreams catalogs
  const [catalogs, setCatalogs] = useState<CatalogInfo[]>([]);
  const [loadingCatalogs, setLoadingCatalogs] = useState(false);
  const [selectedCatalogKey, setSelectedCatalogKey] = useState("");
  const [catalogFilter, setCatalogFilter] = useState("");
  const [catalogSearch, setCatalogSearch] = useState("");
  const [catalogExtras, setCatalogExtras] = useState<Record<string, string>>({});
  const [animeCatalogKey, setAnimeCatalogKey] = useState<string | null>(null);
  const [items, setItems] = useState<BrowseItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [torboxLibraryCatalog, setTorboxLibraryCatalog] = useState(false);
  const [resolving, setResolving] = useState(false);

  const loadCollections = useCallback(async (q: string) => {
    if (!q.trim()) return;
    setLoadingColl(true);
    setError("");
    setActiveCollection(null);
    try {
      const res = await api.browseCollections(q.trim());
      setCollections(res.collections);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Collection search failed");
    } finally {
      setLoadingColl(false);
    }
  }, []);

  const openCollection = async (id: number) => {
    setLoadingColl(true);
    setError("");
    try {
      const res = await api.browseCollection(id);
      setActiveCollection({
        collection_id: id,
        name: res.name,
        overview: res.overview,
        poster: res.poster || "",
        movies: res.movies,
      });
      setCollections([]);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load collection");
    } finally {
      setLoadingColl(false);
    }
  };

  const loadCatalogs = useCallback(async () => {
    setLoadingCatalogs(true);
    setError("");
    try {
      const res = await api.browseCatalogs();
      setCatalogs(res.catalogs);
      const key = res.anime_catalog_key || (res.catalogs[0] ? catalogKey(res.catalogs[0]) : "");
      setAnimeCatalogKey(res.anime_catalog_key ?? null);
      setSelectedCatalogKey(key);
      setCatalogFilter("");
      setCatalogSearch("");
      setCatalogExtras(defaultCatalogExtras(res.catalogs.find((c) => catalogKey(c) === key) ?? null));
      setItems([]);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load catalogs");
    } finally {
      setLoadingCatalogs(false);
    }
  }, []);

  const selectedCatalog = useMemo(() => {
    if (!catalogs.length) return null;
    const found = catalogs.find((c) => catalogKey(c) === selectedCatalogKey);
    return found ?? catalogs[0];
  }, [catalogs, selectedCatalogKey]);

  const loadCatalogItems = useCallback(
    async (
      append: boolean,
      searchOverride?: string,
      extrasOverride?: Record<string, string>
    ) => {
      const cat = selectedCatalog;
      if (!cat) return;
      setLoadingItems(true);
      setError("");
      try {
        const skip = append ? items.length : 0;
        const q = searchOverride !== undefined ? searchOverride : catalogSearch;
        const extras = extrasOverride ?? catalogExtras;
        const res = await api.browseItems(cat.type, cat.id, skip, q, extras);
        setItems((prev) => (append ? [...prev, ...res.items] : res.items));
        setHasMore(res.has_more);
        setTorboxLibraryCatalog(
          !!res.torbox_library || isTorboxLibraryCatalog(cat)
        );
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to load catalog");
      } finally {
        setLoadingItems(false);
      }
    },
    [selectedCatalog, items.length, catalogSearch, catalogExtras]
  );

  const openAnimeBrowse = () => {
    setSource("aiostreams");
    setCatalogFilter("anime");
    if (animeCatalogKey) setSelectedCatalogKey(animeCatalogKey);
  };

  useEffect(() => {
    if (autoOpenAnime) openAnimeBrowse();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpenAnime]);

  useEffect(() => {
    if (source === "aiostreams") loadCatalogs();
  }, [source, loadCatalogs]);

  useEffect(() => {
    if (source !== "aiostreams" || !selectedCatalog) return;
    const extras = defaultCatalogExtras(selectedCatalog);
    setCatalogExtras(extras);
    setCatalogSearch("");
    setItems([]);
    loadCatalogItems(false, "", extras);
  }, [selectedCatalogKey, catalogs.length, source]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (catalogFilter === "anime" && animeCatalogKey) {
      setSelectedCatalogKey(animeCatalogKey);
    }
  }, [animeCatalogKey, catalogFilter]);

  useEffect(() => {
    if (source !== "aiostreams" || !selectedCatalog) return;
    const t = setTimeout(() => {
      setItems([]);
      loadCatalogItems(false);
    }, 350);
    return () => clearTimeout(t);
  }, [catalogSearch]); // eslint-disable-line react-hooks/exhaustive-deps

  const showTorboxDownload =
    allowLocalDownload && torboxLibraryCatalog && source === "aiostreams";

  const downloadTorboxItem = async (item: BrowseItem) => {
    const key = item.stremio_id || item.title;
    setTorboxDownloadBusy(key);
    setError("");
    try {
      await saveBrowseTorboxItemToPc(item);
      pushToast("TorBox download opened in your browser", "success");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "TorBox download failed";
      setError(msg);
      pushToast(msg, "error");
    } finally {
      setTorboxDownloadBusy(null);
    }
  };

  const pickBrowseItem = async (item: BrowseItem) => {
    setResolving(true);
    setError("");
    try {
      const res = await api.browseOpen(item.stremio_id, item.type);
      if (res.action === "collection") {
        setActiveAioCollection({
          collection_id: res.collection_id,
          name: res.name || item.title,
          overview: res.overview || item.overview,
          poster: res.poster || item.poster || "",
          movies: res.movies,
        });
        setItems([]);
        return;
      }
      const resolved = res.title;
      const catalogSid = (item.stremio_id || "").trim();
      onPickTitle({
        ...resolved,
        stremio_id: resolved.stremio_id || catalogSid,
        anime_native: resolved.anime_native || isAnimeStremioId(catalogSid),
        poster: resolved.poster || item.poster,
        overview: resolved.overview || item.overview,
      });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not open this title");
    } finally {
      setResolving(false);
    }
  };

  return (
    <div className="space-y-4">
      {!hideSourceToggle && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setSource("collections")}
            className={source === "collections" ? "btn-primary" : "btn-ghost border border-white/10"}
          >
            <Layers className="mr-1.5 inline h-4 w-4" />
            TMDB Collections
          </button>
          <button
            type="button"
            onClick={() => setSource("aiostreams")}
            className={source === "aiostreams" ? "btn-primary" : "btn-ghost border border-white/10"}
          >
            <Sparkles className="mr-1.5 inline h-4 w-4" />
            AIOStreams catalogs
          </button>
          <button
            type="button"
            onClick={openAnimeBrowse}
            className="btn-ghost border border-violet-500/30 text-violet-200"
            title="Open anime / Kitsu / MAL catalogs from your manifest"
          >
            Anime
          </button>
        </div>
      )}

      {error && <div className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</div>}

      {source === "collections" && (
        <>
          {!activeCollection && (
            <>
              <p className="text-xs text-slate-500">
                Franchise and sequel groupings from TMDB — works with your API key, no Stremio needed.
              </p>
              <div className="flex flex-wrap gap-2">
                {COLLECTION_PRESETS.map((label) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => {
                      setCollQuery(label);
                      loadCollections(label);
                    }}
                    className="chip bg-white/5 text-slate-300 hover:bg-brand-500/20 hover:text-brand-200"
                  >
                    {label}
                  </button>
                ))}
              </div>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  loadCollections(collQuery);
                }}
                className="flex gap-2"
              >
                <input
                  value={collQuery}
                  onChange={(e) => setCollQuery(e.target.value)}
                  placeholder="Search collections (e.g. Matrix, MCU)…"
                  className="input flex-1"
                />
                <button type="submit" disabled={loadingColl || !collQuery.trim()} className="btn-primary px-5">
                  {loadingColl ? <Loader2 className="h-4 w-4 animate-spin" /> : "Find"}
                </button>
              </form>
              {loadingColl && (
                <div className="flex items-center gap-2 text-sm text-slate-400">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading…
                </div>
              )}
              {collections.length > 0 && (
                <div className="grid gap-2 sm:grid-cols-2">
                  {collections.map((c) => (
                    <button
                      key={c.collection_id}
                      onClick={() => openCollection(c.collection_id)}
                      className="card flex gap-3 p-3 text-left hover:bg-white/5"
                    >
                      {c.poster ? (
                        <img src={c.poster} alt="" className="h-16 w-12 rounded object-cover" />
                      ) : (
                        <div className="flex h-16 w-12 items-center justify-center rounded bg-ink-800 text-xs text-slate-600">
                          —
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="font-medium">{c.name}</div>
                        <p className="mt-1 line-clamp-2 text-xs text-slate-500">{c.overview}</p>
                        <div className="mt-2" onClick={(e) => e.stopPropagation()}>
                          <AddToWatchlistButton payload={watchlistFromCollection(c)} label="Add collection" />
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}

          {activeCollection && (
            <div>
              <button
                type="button"
                onClick={() => setActiveCollection(null)}
                className="btn-ghost mb-3 text-xs"
              >
                ← Back to collections
              </button>
              <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold">{activeCollection.name}</h3>
                  {activeCollection.overview && (
                    <p className="mt-1 max-w-2xl text-sm text-slate-400">{activeCollection.overview}</p>
                  )}
                  <p className="mt-2 text-xs text-slate-500">
                    {activeCollection.movies.length} movies · Streams opens here; ↗ or middle/Ctrl+click opens a new
                    tab
                  </p>
                </div>
                <AddToWatchlistButton payload={watchlistFromCollection(activeCollection)} label="Add collection" />
              </div>
              <TitleGrid
                resolving={resolving}
                rows={titleRowsFromSearchResults(activeCollection.movies, onPickTitle)}
              />
            </div>
          )}
        </>
      )}

      {source === "aiostreams" && (
        <>
          <p className="text-xs text-slate-500">
            Rows from catalog addons enabled in your AIOStreams config (Streaming Catalogs, TMDB
            Collections, Marvel, etc.).
          </p>
          {loadingCatalogs && (
            <div className="flex items-center gap-2 text-sm text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading catalogs from manifest…
            </div>
          )}
          {!loadingCatalogs && catalogs.length === 0 && (
            <div className="card space-y-2 p-4 text-sm text-slate-400">
              <div className="flex items-center gap-2 font-medium text-slate-300">
                <FolderOpen className="h-4 w-4" />
                No catalogs in your AIOStreams manifest
              </div>
              <p>
                In AIOStreams → Marketplace, enable catalog addons (e.g. TMDB Collections, Streaming
                Catalogs), click Install/Save, then refresh. Your install URL manifest should list
                catalogs — if it stays empty, re-save config on the AIOStreams configure page.
              </p>
            </div>
          )}
          {activeAioCollection && (
            <div>
              <button
                type="button"
                onClick={() => {
                  setActiveAioCollection(null);
                  loadCatalogItems(false);
                }}
                className="btn-ghost mb-3 text-xs"
              >
                ← Back to catalog
              </button>
              <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold">{activeAioCollection.name}</h3>
                  {activeAioCollection.overview && (
                    <p className="mt-1 max-w-2xl text-sm text-slate-400">{activeAioCollection.overview}</p>
                  )}
                  <p className="mt-2 text-xs text-slate-500">
                    {activeAioCollection.movies.length} movies · Streams opens here; ↗ or middle/Ctrl+click opens a
                    new tab
                  </p>
                </div>
                <AddToWatchlistButton
                  payload={watchlistFromCollection(activeAioCollection)}
                  label="Add collection"
                />
              </div>
              <TitleGrid
                resolving={resolving}
                rows={titleRowsFromSearchResults(activeAioCollection.movies, onPickTitle)}
              />
            </div>
          )}

          {!activeAioCollection && catalogs.length > 0 && (
            <>
              <CatalogPicker
                catalogs={catalogs}
                selectedKey={selectedCatalogKey || (catalogs[0] ? catalogKey(catalogs[0]) : "")}
                onSelect={setSelectedCatalogKey}
                filter={catalogFilter}
                onFilterChange={setCatalogFilter}
              />
              {selectedCatalog && (
                <div
                  className={`grid gap-3 ${
                    visibleCatalogExtras(selectedCatalog).length > 0
                      ? "lg:grid-cols-2 lg:items-end"
                      : ""
                  }`}
                >
                  <label className="block text-xs text-slate-400">
                    Search this catalog
                    <div className="relative mt-1">
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
                      <input
                        type="search"
                        value={catalogSearch}
                        onChange={(e) => setCatalogSearch(e.target.value)}
                        placeholder="Title search (AIOStreams catalog extra)…"
                        className="input py-2 pl-9 text-sm"
                      />
                    </div>
                  </label>
                  <CatalogExtrasPanel
                    catalog={selectedCatalog}
                    values={catalogExtras}
                    onChange={(name, value) => setCatalogExtras((prev) => ({ ...prev, [name]: value }))}
                    onApply={() => {
                      setItems([]);
                      loadCatalogItems(false);
                    }}
                    loading={loadingItems}
                    inline
                  />
                </div>
              )}
              {loadingItems && items.length === 0 ? (
                <div className="flex items-center gap-2 py-6 text-sm text-slate-400">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading titles…
                </div>
              ) : items.length === 0 ? (
                <div className="rounded-xl border border-white/5 bg-black/20 px-4 py-8 text-center text-sm text-slate-400">
                  <p className="font-medium text-slate-300">No titles in this catalog</p>
                  <p className="mt-2 text-xs">
                    Some AIOStreams catalogs (e.g. Popular AniDB) return empty lists from the addon — try
                    AniList or MyAnimeList catalogs instead.
                  </p>
                </div>
              ) : (
                <>
                  {showTorboxDownload && (
                    <p className="text-xs text-sky-300/90">
                      TorBox library — use <span className="text-sky-200">TorBox download</span> for items already on
                      your account (no stream search needed).
                    </p>
                  )}
                  <TitleGrid
                    resolving={resolving}
                    rows={items.map((item, i) => {
                      const isCollection = item.kind === "collection";
                      const watchlist = watchlistFromBrowseItem(item);
                      const openParams = streamOpenFromBrowseItem(item);
                      const rowKey = item.stremio_id || String(i);
                      return {
                        key: rowKey,
                        title: item.title,
                        year: item.year,
                        poster: item.poster,
                        rating: item.rating,
                        badge: isCollection ? "Collection" : item.kind === "anime" ? "Anime" : undefined,
                        openParams: openParams ?? undefined,
                        watchlist: watchlist ?? undefined,
                        onOpen: () => pickBrowseItem(item),
                        onTorboxDownload:
                          showTorboxDownload && !isCollection
                            ? () => downloadTorboxItem(item)
                            : undefined,
                        torboxDownloadBusy: torboxDownloadBusy === rowKey,
                      };
                    })}
                  />
                  {hasMore && (
                    <button
                      type="button"
                      disabled={loadingItems}
                      onClick={() => loadCatalogItems(true)}
                      className="btn-ghost mt-3 w-full border border-white/10"
                    >
                      {loadingItems ? (
                        <Loader2 className="mx-auto h-4 w-4 animate-spin" />
                      ) : (
                        "Load more"
                      )}
                    </button>
                  )}
                </>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
