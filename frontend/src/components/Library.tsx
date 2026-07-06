import {
  BookmarkPlus,
  Film,
  HardDriveDownload,
  Languages,
  Link2,
  ListPlus,
  Loader2,
  Pencil,
  Play,
  RefreshCw,
  Search,
  Trash2,
  Unlink,
  RefreshCcw,
  Youtube,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { fmtBytes, fmtDuration } from "../format";
import { canLocalDownload, saveLibraryItemToPc } from "../localDownload";
import {
  filterAndSortLibrary,
  LIBRARY_FILTER_OPTIONS,
  LIBRARY_SORT_OPTIONS,
  linkApplies,
  type LibraryFilter,
  type LibrarySort,
} from "../libraryView";
import type { LibraryItem, UserInfo } from "../types";
import { useWatchlistAdd } from "../watchlistAddModal";
import { ConfirmModal } from "./ConfirmModal";
import { KebabMenu, type KebabMenuItem } from "./KebabMenu";
import { LinkTmdbModal } from "./LinkTmdbModal";
import { libraryLinkLabel, watchlistPayloadFromLibraryItem } from "./libraryWatchlist";
import { PlaybackTracksPanel } from "./PlaybackTracksPanel";
import { usePlayback } from "./PlaybackContext";
import { useToast } from "./Toast";

const FOLDER_META: Record<string, { label: string; icon: typeof Youtube }> = {
  youtube: { label: "YouTube", icon: Youtube },
  m3u8: { label: "M3U8 / Streams", icon: Link2 },
  torrents: { label: "Movies & Shows", icon: Film },
};

export function Library({ version, user }: { version: number; user: UserInfo }) {
  const { playFromLibrary, queueFromLibrary } = usePlayback();
  const { push: pushToast } = useToast();
  const { openWatchlistAdd } = useWatchlistAdd();
  const [data, setData] = useState<Record<string, LibraryItem[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [scanning, setScanning] = useState(false);
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameBusy, setRenameBusy] = useState(false);
  const [linkItem, setLinkItem] = useState<LibraryItem | null>(null);
  const [linkMode, setLinkMode] = useState<"link" | "relink">("link");
  const [unlinkBusy, setUnlinkBusy] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<LibraryItem | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [tracksItemId, setTracksItemId] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<LibrarySort>("recent");
  const [filter, setFilter] = useState<LibraryFilter>("all");

  const load = () => {
    setError("");
    api
      .library()
      .then(setData)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Could not load library"))
      .finally(() => setLoading(false));
  };

  const waitForScan = () => {
    window.setTimeout(async () => {
      try {
        const status = await api.libraryScanStatus();
        if (status.scanning) {
          waitForScan();
          return;
        }
        setScanning(false);
        load();
        pushToast("Library scan complete", "success");
      } catch (err: unknown) {
        setScanning(false);
        setError(err instanceof Error ? err.message : "Could not check scan status");
      }
    }, 1000);
  };

  useEffect(load, [version]);

  const scan = async () => {
    setScanning(true);
    try {
      await api.scanLibrary();
      pushToast("Library scan started", "info");
      waitForScan();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not scan library");
      setScanning(false);
    }
  };

  const titleFor = (item: LibraryItem) => item.display_title || item.title;

  const addToQueue = (item: LibraryItem) => queueFromLibrary(item);
  const playNow = (item: LibraryItem) => playFromLibrary(item);

  const remove = async () => {
    if (!deleteTarget) return;
    setDeleteBusy(true);
    try {
      await api.deleteLibraryItem(deleteTarget.id);
      setDeleteTarget(null);
      load();
    } catch (err: unknown) {
      pushToast(err instanceof Error ? err.message : "Delete failed", "error");
    } finally {
      setDeleteBusy(false);
    }
  };

  const startRename = (item: LibraryItem) => {
    setRenamingId(item.id);
    setRenameValue(item.title);
  };

  const cancelRename = () => {
    setRenamingId(null);
    setRenameValue("");
  };

  const submitRename = async (item: LibraryItem) => {
    const title = renameValue.trim();
    if (!title || title === item.title) {
      cancelRename();
      return;
    }
    setRenameBusy(true);
    try {
      await api.renameLibraryItem(item.id, title);
      cancelRename();
      load();
    } catch (err: unknown) {
      pushToast(err instanceof Error ? err.message : "Rename failed", "error");
    } finally {
      setRenameBusy(false);
    }
  };

  const unlink = async (item: LibraryItem) => {
    setUnlinkBusy(item.id);
    try {
      await api.unlinkLibraryItem(item.id);
      load();
    } catch (err: unknown) {
      pushToast(err instanceof Error ? err.message : "Unlink failed", "error");
    } finally {
      setUnlinkBusy(null);
    }
  };

  const posterFor = (item: LibraryItem) => item.poster || item.thumbnail;

  const total = Object.values(data).reduce((n, arr) => n + arr.length, 0);
  const allowLocalDownload = canLocalDownload(user);

  const saveToPc = async (item: LibraryItem) => {
    try {
      await saveLibraryItemToPc(item.id);
      pushToast("Opening TorBox download in your browser", "success");
    } catch (err: unknown) {
      pushToast(err instanceof Error ? err.message : "Could not open TorBox link", "error");
    }
  };

  const filteredData = useMemo(() => {
    const out: Record<string, LibraryItem[]> = {};
    for (const [key, items] of Object.entries(data)) {
      out[key] = filterAndSortLibrary(items, query, sort, filter);
    }
    return out;
  }, [data, query, sort, filter]);
  const filteredTotal = Object.values(filteredData).reduce((n, arr) => n + arr.length, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Library</h1>
          <p className="mt-1 text-sm text-slate-400">{total} videos ready to queue.</p>
        </div>
        <button onClick={scan} disabled={scanning} className="btn-ghost">
          <RefreshCw className={`h-4 w-4 ${scanning ? "animate-spin" : ""}`} /> Rescan
        </button>
      </div>

      {total > 0 && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by title or filename…"
              className="input w-full !pl-8"
            />
          </div>
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as LibraryFilter)}
            className="input sm:w-44"
            title="Filter by link/watchlist state"
          >
            {LIBRARY_FILTER_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as LibrarySort)}
            className="input sm:w-52"
          >
            {LIBRARY_SORT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 py-12 text-slate-400">
          <Loader2 className="h-5 w-5 animate-spin" /> Loading…
        </div>
      ) : error ? (
        <div className="card p-8 text-center">
          <p className="text-sm text-red-300">{error}</p>
          <button type="button" onClick={load} className="btn-ghost mt-3 text-sm">
            Try again
          </button>
        </div>
      ) : total === 0 ? (
        <div className="card p-12 text-center text-slate-500">
          Nothing here yet. Download something first.
        </div>
      ) : filteredTotal === 0 ? (
        <div className="card p-12 text-center text-slate-500">
          {query.trim()
            ? `No videos match “${query}”.`
            : filter === "needs_link"
              ? "Everything is linked — nothing needs attention."
              : filter === "not_on_watchlist"
                ? "Every linked video is on the watchlist."
                : "No videos match your filters."}
        </div>
      ) : (
        Object.entries(FOLDER_META).map(([key, meta]) => {
          const items = filteredData[key] || [];
          if (items.length === 0) return null;
          const Icon = meta.icon;
          return (
            <section key={key} className="space-y-3">
              <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-400">
                <Icon className="h-4 w-4" /> {meta.label} · {items.length}
              </h2>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {items.map((item) => {
                  const kebabItems: KebabMenuItem[] = [
                    {
                      label: tracksItemId === item.id ? "Hide tracks" : "Audio & subtitles",
                      icon: <Languages className="h-3.5 w-3.5" />,
                      onClick: () => setTracksItemId((id) => (id === item.id ? null : item.id)),
                    },
                  ];
                  if (allowLocalDownload && item.folder === "torrents") {
                    kebabItems.push({
                      label: "TorBox download",
                      icon: <HardDriveDownload className="h-3.5 w-3.5" />,
                      onClick: () => saveToPc(item),
                    });
                  }
                  if (item.linked) {
                    kebabItems.push({
                      label: "Relink",
                      icon: <RefreshCcw className="h-3.5 w-3.5" />,
                      onClick: () => {
                        setLinkMode("relink");
                        setLinkItem(item);
                      },
                    });
                    kebabItems.push({
                      label: "Unlink TMDB",
                      icon: <Unlink className="h-3.5 w-3.5" />,
                      onClick: () => unlink(item),
                      disabled: unlinkBusy === item.id,
                    });
                  } else {
                    kebabItems.push({
                      label: "Link to movie/show",
                      icon: <Link2 className="h-3.5 w-3.5" />,
                      onClick: () => {
                        setLinkMode("link");
                        setLinkItem(item);
                      },
                    });
                  }
                  if (!item.linked || !item.on_watchlist) {
                    kebabItems.push({
                      label: "Add to watchlist",
                      icon: <BookmarkPlus className="h-3.5 w-3.5" />,
                      onClick: () => openWatchlistAdd(watchlistPayloadFromLibraryItem(item)),
                    });
                  }
                  kebabItems.push({
                    label: "Rename",
                    icon: <Pencil className="h-3.5 w-3.5" />,
                    onClick: () => startRename(item),
                  });
                  kebabItems.push({
                    label: "Delete",
                    icon: <Trash2 className="h-3.5 w-3.5" />,
                    onClick: () => setDeleteTarget(item),
                    destructive: true,
                  });

                  return (
                  <div key={item.id} className="card overflow-hidden">
                    <div className="relative aspect-video w-full overflow-hidden bg-ink-800">
                      {posterFor(item) ? (
                        <>
                          {/* Blurred cover copy fills the 16:9 slot; the real
                              art renders uncropped on top, so portrait posters
                              keep their heads. */}
                          <img
                            src={posterFor(item)}
                            alt=""
                            aria-hidden
                            loading="lazy"
                            decoding="async"
                            className="absolute inset-0 h-full w-full scale-110 object-cover opacity-35 blur-lg"
                          />
                          <img
                            src={posterFor(item)}
                            alt=""
                            loading="lazy"
                            decoding="async"
                            className="relative h-full w-full object-contain"
                          />
                        </>
                      ) : (
                        <div className="grid h-full place-items-center text-slate-600">
                          <Film className="h-8 w-8" />
                        </div>
                      )}
                      {libraryLinkLabel(item) && (
                        <span className="absolute left-1.5 top-1.5 chip bg-brand-500/80 text-brand-ink">
                          {libraryLinkLabel(item)}
                        </span>
                      )}
                      {linkApplies(item) && !item.linked && (
                        <span className="absolute left-1.5 top-1.5 chip border border-amber-500/40 bg-ink-950/70 text-amber-300">
                          Unlinked
                        </span>
                      )}
                      {item.linked && item.on_watchlist === false && (
                        <span className="absolute right-1.5 top-1.5 chip border border-amber-500/50 bg-amber-500/20 text-amber-200">
                          Not on watchlist
                        </span>
                      )}
                      {item.linked && item.on_watchlist && (
                        <span className="absolute right-1.5 top-1.5 chip bg-emerald-500/20 text-emerald-300">
                          On watchlist
                        </span>
                      )}
                      {item.duration > 0 && (
                        <span className="absolute bottom-1.5 right-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[11px]">
                          {fmtDuration(item.duration)}
                        </span>
                      )}
                    </div>
                    <div className="p-2.5">
                      {renamingId === item.id ? (
                        <form
                          className="flex items-center gap-1"
                          onSubmit={(e) => {
                            e.preventDefault();
                            submitRename(item);
                          }}
                        >
                          <input
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            className="input !py-1 !text-xs"
                            autoFocus
                            disabled={renameBusy}
                          />
                          <button
                            type="submit"
                            disabled={renameBusy || !renameValue.trim()}
                            className="rounded-lg p-1 text-emerald-400 hover:bg-white/10"
                            title="Save"
                          >
                            {renameBusy ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <span className="text-xs font-semibold">OK</span>
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={cancelRename}
                            className="rounded-lg p-1 text-slate-400 hover:bg-white/10"
                            title="Cancel"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </form>
                      ) : (
                        <div
                          className="truncate text-sm font-medium cursor-pointer hover:text-brand-300"
                          title={`${titleFor(item)} — click pencil to rename`}
                          onClick={() => startRename(item)}
                        >
                          {titleFor(item)}
                        </div>
                      )}
                      <div className="mt-0.5 text-xs text-slate-500">{fmtBytes(item.size)}</div>
                      <div className="mt-1.5 flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => playNow(item)}
                          className="btn-primary flex-1 justify-center py-1 text-[11px]"
                          title="Play now"
                        >
                          <Play className="h-3 w-3" /> Play
                        </button>
                        <button
                          type="button"
                          onClick={() => addToQueue(item)}
                          className="btn-ghost flex-1 justify-center py-1 text-[11px]"
                          title="Add to queue"
                        >
                          <ListPlus className="h-3 w-3" /> Queue
                        </button>
                        <KebabMenu items={kebabItems} label={`More actions for ${titleFor(item)}`} />
                      </div>
                      {tracksItemId === item.id && (
                        <div className="mt-1.5">
                          <PlaybackTracksPanel libraryId={item.id} compact />
                        </div>
                      )}
                    </div>
                  </div>
                  );
                })}
              </div>
            </section>
          );
        })
      )}

      {linkItem && (
        <LinkTmdbModal
          item={linkItem}
          mode={linkMode}
          onClose={() => setLinkItem(null)}
          onLinked={() => load()}
        />
      )}

      <ConfirmModal
        open={!!deleteTarget}
        title="Delete from library?"
        message={
          deleteTarget ? (
            <>
              Permanently delete <span className="font-medium text-white">{titleFor(deleteTarget)}</span> from
              disk? Watchlist history is kept.
            </>
          ) : null
        }
        confirmLabel="Delete"
        danger
        busy={deleteBusy}
        onConfirm={remove}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
