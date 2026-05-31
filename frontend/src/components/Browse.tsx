import { Check, Download, FolderOpen, Layers, Loader2, Search, Sparkles } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { AddToWatchlistButton, type WatchlistAddPayload } from "./AddToWatchlist";
import { StreamOpenLink, StreamNewTabButton, BROWSE_CARD } from "./StreamOpenLink";
import type { BrowseItem, CatalogInfo, SearchResult, TmdbCollectionSummary } from "../types";
import { streamOpenFromBrowseItem, streamOpenFromSearchResult, type StreamOpenParams } from "../streamOpenUrl";

type CollectionView = {
  name: string;
  overview: string;
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

function watchlistFromBrowseItem(item: BrowseItem): WatchlistAddPayload | null {
  if (item.kind === "collection") return null;
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

export function Browse({ onPickTitle }: { onPickTitle: (r: SearchResult) => void }) {
  const [source, setSource] = useState<BrowseSource>("collections");
  const [error, setError] = useState("");

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
  const [items, setItems] = useState<BrowseItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [hasMore, setHasMore] = useState(false);
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
        name: res.name,
        overview: res.overview,
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
      setSelectedCatalogKey(res.catalogs[0] ? catalogKey(res.catalogs[0]) : "");
      setCatalogFilter("");
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
    async (append: boolean) => {
      const cat = selectedCatalog;
      if (!cat) return;
      setLoadingItems(true);
      setError("");
      try {
        const skip = append ? items.length : 0;
        const res = await api.browseItems(cat.type, cat.id, skip);
        setItems((prev) => (append ? [...prev, ...res.items] : res.items));
        setHasMore(res.has_more);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to load catalog");
      } finally {
        setLoadingItems(false);
      }
    },
    [selectedCatalog, items.length]
  );

  useEffect(() => {
    if (source === "aiostreams") loadCatalogs();
  }, [source, loadCatalogs]);

  useEffect(() => {
    if (source === "aiostreams" && catalogs.length > 0) {
      setItems([]);
      loadCatalogItems(false);
    }
  }, [selectedCatalogKey, catalogs.length, source]); // eslint-disable-line react-hooks/exhaustive-deps

  const pickBrowseItem = async (item: BrowseItem) => {
    setResolving(true);
    setError("");
    try {
      const res = await api.browseOpen(item.stremio_id, item.type);
      if (res.action === "collection") {
        setActiveAioCollection({
          name: res.name || item.title,
          overview: res.overview || item.overview,
          movies: res.movies,
        });
        setItems([]);
        return;
      }
      const resolved = res.title;
      onPickTitle({
        ...resolved,
        poster: resolved.poster || item.poster,
        overview: resolved.overview || item.overview,
      });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not open this title");
    } finally {
      setResolving(false);
    }
  };

  const TitleGrid = ({
    rows,
  }: {
    rows: {
      key: string;
      title: string;
      year: string;
      poster: string;
      rating: number;
      badge?: string;
      watchlist?: WatchlistAddPayload;
      openParams?: StreamOpenParams;
      onOpen: () => void;
    }[];
  }) => (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {rows.map((r) => (
        <div key={r.key} className={BROWSE_CARD}>
          {r.openParams ? (
            <StreamOpenLink
              params={r.openParams}
              onOpenInPlace={r.onOpen}
              disabled={resolving}
              className="block w-full text-left no-underline text-inherit"
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
                <div className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-400">
                  {r.badge && <span className="chip bg-brand-500/15 text-brand-300">{r.badge}</span>}
                  <span>{r.year || "—"}</span>
                </div>
              </div>
            </StreamOpenLink>
          ) : (
            <button
              type="button"
              onClick={r.onOpen}
              disabled={resolving}
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
                <div className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-400">
                  {r.badge && <span className="chip bg-brand-500/15 text-brand-300">{r.badge}</span>}
                  <span>{r.year || "—"}</span>
                </div>
              </div>
            </button>
          )}
          {r.openParams && (
            <div className="flex gap-1 border-t border-white/5 px-2 pb-2 pt-1">
              {r.watchlist && (
                <AddToWatchlistButton
                  payload={r.watchlist}
                  label="Watchlist"
                  className="btn-ghost min-w-0 flex-1 justify-center py-1 text-[10px]"
                />
              )}
              <StreamOpenLink
                params={r.openParams}
                onOpenInPlace={r.onOpen}
                disabled={resolving}
                title="Middle-click or Ctrl+click to open in a new tab"
                className="btn-primary min-w-0 flex-1 justify-center py-1 text-[10px] no-underline"
              >
                <Download className="h-3 w-3" /> Streams
              </StreamOpenLink>
              <StreamNewTabButton params={r.openParams} disabled={resolving} />
            </div>
          )}
        </div>
      ))}
    </div>
  );

  return (
    <div className="space-y-4">
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
      </div>

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
              <h3 className="text-lg font-semibold">{activeCollection.name}</h3>
              {activeCollection.overview && (
                <p className="mt-1 max-w-2xl text-sm text-slate-400">{activeCollection.overview}</p>
              )}
              <p className="mb-3 mt-2 text-xs text-slate-500">
                {activeCollection.movies.length} movies · Streams opens here; ↗ or middle/Ctrl+click opens a new tab
              </p>
              <TitleGrid
                rows={activeCollection.movies.map((m) => ({
                  key: `m-${m.tmdb_id}`,
                  title: m.title,
                  year: m.year,
                  poster: m.poster,
                  rating: m.rating,
                  openParams: streamOpenFromSearchResult(m),
                  watchlist: watchlistFromSearchResult(m),
                  onOpen: () => onPickTitle(m),
                }))}
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
              <h3 className="text-lg font-semibold">{activeAioCollection.name}</h3>
              {activeAioCollection.overview && (
                <p className="mt-1 max-w-2xl text-sm text-slate-400">{activeAioCollection.overview}</p>
              )}
              <p className="mb-3 mt-2 text-xs text-slate-500">
                {activeAioCollection.movies.length} movies · Streams opens here; ↗ or middle/Ctrl+click opens a new tab
              </p>
              <TitleGrid
                rows={activeAioCollection.movies.map((m) => ({
                  key: `m-${m.tmdb_id}`,
                  title: m.title,
                  year: m.year,
                  poster: m.poster,
                  rating: m.rating,
                  openParams: streamOpenFromSearchResult(m),
                  watchlist: watchlistFromSearchResult(m),
                  onOpen: () => onPickTitle(m),
                }))}
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
              {loadingItems && items.length === 0 ? (
                <div className="flex items-center gap-2 py-6 text-sm text-slate-400">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading titles…
                </div>
              ) : (
                <>
                  <TitleGrid
                    rows={items.map((item, i) => {
                      const isCollection = item.kind === "collection";
                      const watchlist = watchlistFromBrowseItem(item);
                      const openParams = streamOpenFromBrowseItem(item);
                      return {
                        key: item.stremio_id || String(i),
                        title: item.title,
                        year: item.year,
                        poster: item.poster,
                        rating: item.rating,
                        badge: isCollection ? "Collection" : undefined,
                        openParams: openParams ?? undefined,
                        watchlist: watchlist ?? undefined,
                        onOpen: () => pickBrowseItem(item),
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
