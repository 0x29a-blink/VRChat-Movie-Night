import { Link2, Loader2, Search as SearchIcon, X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../api";
import type { SearchResult, WatchlistItem } from "../types";

/** Link a watchlist series row to TMDB for full season/episode catalogs (keeps anime id for streams). */
export function LinkWatchlistTmdbModal({
  item,
  onClose,
  onLinked,
}: {
  item: WatchlistItem;
  onClose: () => void;
  onLinked: (updated: WatchlistItem) => void;
}) {
  const [query, setQuery] = useState(item.title);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<SearchResult | null>(null);
  const [seasonCount, setSeasonCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [updateDisplay, setUpdateDisplay] = useState(true);

  const doSearch = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!query.trim()) return;
    setSearching(true);
    setError("");
    setSelected(null);
    setSeasonCount(0);
    try {
      const rows = await api.search(query.trim());
      setResults(rows.filter((r) => r.type === "series"));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Search failed");
    } finally {
      setSearching(false);
    }
  };

  const pickTitle = async (r: SearchResult) => {
    setSelected(r);
    try {
      const d = await api.titleDetails(r.tmdb_id, "series");
      setSeasonCount(d.seasons?.length ?? 0);
    } catch {
      setSeasonCount(0);
    }
  };

  useEffect(() => {
    if (!item.title) return;
    doSearch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const link = async () => {
    if (!selected?.tmdb_id) return;
    setBusy(true);
    setError("");
    try {
      const res = await api.watchlistLinkTmdbCatalog(item.id, selected.tmdb_id, updateDisplay);
      onLinked(res.series);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Link failed");
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="card flex max-h-[90vh] w-full max-w-lg flex-col"
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-white/5 px-4 py-3">
          <h3 className="text-sm font-semibold">Link TMDB catalog</h3>
          <button type="button" onClick={onClose} className="btn-ghost px-2">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3 overflow-y-auto p-4">
          <p className="text-xs text-slate-400">
            Use this when the anime entry only lists one season but TMDB has the full show. Season
            bulk-add and episode metadata will come from TMDB.{" "}
            {item.stremio_id ? (
              <span className="text-slate-300">Your kitsu/mal id is kept for finding streams.</span>
            ) : null}
          </p>

          <form onSubmit={doSearch} className="flex gap-2">
            <input
              className="input flex-1"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search TMDB for the series…"
            />
            <button type="submit" disabled={searching} className="btn-primary shrink-0">
              {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <SearchIcon className="h-4 w-4" />}
            </button>
          </form>

          {error && <p className="text-xs text-red-300">{error}</p>}

          <div className="max-h-48 space-y-1 overflow-y-auto">
            {results.map((r) => (
              <button
                key={`${r.type}-${r.tmdb_id}`}
                type="button"
                onClick={() => pickTitle(r)}
                className={`flex w-full gap-2 rounded-lg p-2 text-left ${
                  selected?.tmdb_id === r.tmdb_id ? "bg-brand-500/20 ring-1 ring-brand-500/50" : "hover:bg-white/5"
                }`}
              >
                {r.poster ? (
                  <img src={r.poster} alt="" className="h-12 w-8 rounded object-cover" />
                ) : (
                  <div className="h-12 w-8 rounded bg-ink-800" />
                )}
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{r.title}</div>
                  <div className="text-xs text-slate-500">{r.year}</div>
                </div>
              </button>
            ))}
          </div>

          {selected && (
            <p className="text-xs text-emerald-300">
              Selected: {selected.title} — {seasonCount} season{seasonCount === 1 ? "" : "s"} on TMDB
            </p>
          )}

          <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-300">
            <input
              type="checkbox"
              checked={updateDisplay}
              onChange={(e) => setUpdateDisplay(e.target.checked)}
              className="h-4 w-4 rounded accent-brand-500"
            />
            Update poster &amp; description from TMDB
          </label>
        </div>

        <div className="flex justify-end gap-2 border-t border-white/5 p-4">
          <button type="button" onClick={onClose} className="btn-ghost">
            Cancel
          </button>
          <button type="button" disabled={!selected || busy} onClick={link} className="btn-primary">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
            Link catalog
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
