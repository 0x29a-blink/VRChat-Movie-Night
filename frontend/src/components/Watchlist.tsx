import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ChevronDown,
  ChevronRight,
  GripVertical,
  Link2,
  ListPlus,
  Loader2,
  MessageSquare,
  Play,
  Plus,
  RotateCw,
  Star,
  Search,
  Trash2,
  UserMinus,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../api";
import type { TmdbEpisode, UserInfo, WatchlistGroup, WatchlistItem, WatchlistUserWatch } from "../types";
import { streamTargetFromWatchlistItem, type StreamTarget } from "./streamTarget";
import { InLibraryChip } from "./InLibraryChip";
import { TitleMediaActions } from "./TitleMediaActions";
import { canLocalDownload } from "../localDownload";
import { TitleStreamsModal } from "./TitleStreamsModal";
import { WheelSpinModal } from "./WheelSpinModal";
import { usePlayback } from "./PlaybackContext";
import { LinkWatchlistTmdbModal } from "./LinkWatchlistTmdbModal";
import { useToast } from "./Toast";

const GROUP_TEMPLATES = ["Horror Month", "Anime Night", "Movie Backlog", "Series Night", "Finished"];

function DeleteConfirmModal({
  item,
  busy,
  onCancel,
  onConfirm,
}: {
  item: WatchlistItem;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return createPortal(
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/70 p-4" onClick={onCancel}>
      <div
        className="card w-full max-w-sm p-5"
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-semibold text-red-300">Remove from watchlist?</h3>
        <p className="mt-2 text-sm text-white">{item.title}</p>
        {item.kind === "series" && (
          <p className="mt-2 text-xs text-slate-400">
            This will permanently delete the series and all of its tracked episodes, ratings, and comments.
          </p>
        )}
        {item.kind === "episode" && (
          <p className="mt-2 text-xs text-slate-400">
            This will permanently delete this episode and its ratings and comments.
          </p>
        )}
        {item.kind === "movie" && (
          <p className="mt-2 text-xs text-slate-400">
            This will permanently delete this title and its ratings and comments.
          </p>
        )}
        <div className="mt-5 flex gap-2">
          <button type="button" onClick={onCancel} disabled={busy} className="btn-ghost flex-1">
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="btn-primary flex-1 !bg-red-600 hover:!bg-red-500"
          >
            {busy ? "Removing…" : "Remove"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

function stopDrag(e: React.PointerEvent | React.MouseEvent) {
  e.stopPropagation();
}

type WatchedSort = "needs_rating" | "recent" | "oldest" | "title";

function watchedSortLabel(sort: WatchedSort) {
  switch (sort) {
    case "needs_rating":
      return "Needs rating first";
    case "recent":
      return "Most recently watched";
    case "oldest":
      return "Oldest watched";
    case "title":
      return "Title A–Z";
  }
}

function compareWatchedAt(a: WatchlistItem, b: WatchlistItem) {
  const ta = a.my_watched_at ? Date.parse(a.my_watched_at) : 0;
  const tb = b.my_watched_at ? Date.parse(b.my_watched_at) : 0;
  return tb - ta;
}

function sortWatchedItems(items: WatchlistItem[], sort: WatchedSort) {
  const copy = [...items];
  copy.sort((a, b) => {
    if (sort === "needs_rating") {
      const diff = (b.my_unrated_count ?? 0) - (a.my_unrated_count ?? 0);
      if (diff !== 0) return diff;
      return compareWatchedAt(a, b);
    }
    if (sort === "recent") return compareWatchedAt(a, b);
    if (sort === "oldest") return compareWatchedAt(b, a);
    if (sort === "title") return a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
    return a.sort_order - b.sort_order;
  });
  return copy;
}

function NeedsRatingBadge({ count, className = "" }: { count: number; className?: string }) {
  if (count <= 0) return null;
  return (
    <span
      className={`inline-flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-amber-400/55 px-0.5 text-[9px] font-bold leading-none text-ink-900 ${className}`}
      title={`${count} watched item${count === 1 ? "" : "s"} not rated yet`}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

function WatchedCountWithBadge({
  watched,
  needsRating,
  className = "",
}: {
  watched: number;
  needsRating: number;
  className?: string;
}) {
  const count = needsRating > 0 ? (needsRating > 99 ? "99+" : String(needsRating)) : null;
  return (
    <span className={`relative inline-block tabular-nums ${className}`}>
      {watched}
      {count && (
        <span
          className="absolute -right-2 -top-1 flex h-2.5 min-w-2.5 items-center justify-center rounded-[3px] bg-amber-400/50 px-px text-[7px] font-bold leading-none text-ink-900"
          title={`${needsRating} not rated yet`}
        >
          {count}
        </span>
      )}
    </span>
  );
}

function GroupMoveSelect({
  item,
  groups,
  onMoved,
}: {
  item: WatchlistItem;
  groups: WatchlistGroup[];
  onMoved: () => void;
}) {
  const current = item.group_id ?? 0;
  const move = async (groupId: number) => {
    if (groupId === current) return;
    await api.watchlistPatchItem(item.id, { group_id: groupId });
    onMoved();
  };

  return (
    <label className="flex shrink-0 items-center gap-1 text-[11px] text-slate-400" onPointerDown={stopDrag}>
      <span className="shrink-0">Group</span>
      <select
        value={current}
        onChange={(e) => move(Number(e.target.value))}
        className="input max-w-[9rem] py-0.5 text-[11px]"
      >
        <option value={0}>Ungrouped</option>
        {groups.map((g) => (
          <option key={g.id} value={g.id}>
            {g.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function UserWatchBadges({
  users,
  currentUserId,
  onToggleSelf,
  compact = false,
}: {
  users: WatchlistUserWatch[];
  currentUserId: number;
  onToggleSelf?: () => void;
  compact?: boolean;
}) {
  if (users.length === 0) return null;

  return (
    <div className={`flex flex-wrap gap-1 ${compact ? "" : "mt-2"}`}>
      {users.map((u) => {
        const isSelf = u.user_id === currentUserId;
        const epNote =
          u.episodes_total != null && u.episodes_total > 0
            ? ` · ${u.episodes_watched ?? 0}/${u.episodes_total} eps`
            : "";
        return (
          <button
            key={u.user_id}
            type="button"
            disabled={!isSelf || !onToggleSelf}
            onClick={isSelf ? onToggleSelf : undefined}
            onPointerDown={stopDrag}
            title={
              u.watched
                ? `${u.username} watched${epNote}`
                : `${u.username} has not watched yet${epNote}`
            }
            className={`chip text-[10px] ${
              u.watched
                ? "bg-emerald-500/20 text-emerald-300"
                : "bg-white/5 text-slate-500"
            } ${isSelf && onToggleSelf ? "cursor-pointer hover:ring-1 hover:ring-brand-500/40" : "cursor-default"}`}
          >
            <span className={isSelf ? "font-medium" : ""}>{u.username}</span>
            <span className="ml-1">{u.watched ? "✓" : "○"}</span>
            {u.episodes_total != null && u.episodes_total > 0 && (
              <span className="ml-0.5 opacity-75">
                {u.episodes_watched}/{u.episodes_total}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function StatsExclusionMenu({
  item,
  onUpdate,
}: {
  item: WatchlistItem;
  onUpdate: (item: WatchlistItem) => void;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const [users, setUsers] = useState<
    { user_id: number; username: string; globally_excluded: boolean; excluded_on_item: boolean }[]
  >([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);

  const loadUsers = useCallback(() => {
    setLoading(true);
    api
      .watchlistItemStatsExclusions(item.id)
      .then((r) => setUsers(r.users))
      .finally(() => setLoading(false));
  }, [item.id]);

  useEffect(() => {
    if (open) loadUsers();
  }, [open, loadUsers]);

  useEffect(() => {
    if (!open || !buttonRef.current) return;

    const updatePosition = () => {
      const rect = buttonRef.current!.getBoundingClientRect();
      const panelWidth = 288;
      const left = Math.max(8, Math.min(rect.right - panelWidth, window.innerWidth - panelWidth - 8));
      setMenuPos({ top: rect.bottom + 6, left });
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open]);

  const toggle = async (userId: number, excluded: boolean) => {
    setBusyId(userId);
    try {
      const next = await api.watchlistSetItemStatsExclusion(item.id, userId, excluded);
      onUpdate(next);
      loadUsers();
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        onPointerDown={stopDrag}
        className="btn-ghost shrink-0 px-1 py-0.5 text-slate-400"
        title="Hide users from group stats on this title"
      >
        <UserMinus className="h-3 w-3" />
      </button>
      {open &&
        menuPos &&
        createPortal(
          <>
            <button
              type="button"
              className="fixed inset-0 z-[100]"
              aria-label="Close menu"
              onClick={() => setOpen(false)}
            />
            <div
              className="fixed z-[101] w-72 max-w-[calc(100vw-1rem)] rounded-lg border border-white/10 bg-ink-900 p-3 shadow-xl"
              style={{ top: menuPos.top, left: menuPos.left }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-2 text-xs font-medium text-slate-200">Group stats visibility</div>
              <p className="mb-2 text-[10px] leading-snug text-slate-500">
                Hidden users are omitted from watched counts and ratings here. They reappear if they rate, comment, or
                mark watched.
              </p>
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
              ) : (
                <ul className="max-h-48 space-y-1 overflow-y-auto">
                  {users.map((u) => {
                    const excluded = u.globally_excluded || u.excluded_on_item;
                    return (
                      <li key={u.user_id} className="flex items-center justify-between gap-2 text-xs">
                        <span className="truncate text-slate-300">
                          {u.username}
                          {u.globally_excluded && (
                            <span className="ml-1 text-[10px] text-amber-400">global</span>
                          )}
                        </span>
                        <label className="flex shrink-0 items-center gap-1 text-slate-400">
                          <input
                            type="checkbox"
                            checked={excluded}
                            disabled={u.globally_excluded || busyId === u.user_id}
                            onChange={(e) => toggle(u.user_id, e.target.checked)}
                          />
                          hide
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </>,
          document.body
        )}
    </>
  );
}

function formatRating(stars: number) {
  const full = Math.floor(stars);
  const half = stars - full >= 0.5;
  return `${"★".repeat(full)}${half ? "½" : ""}${"☆".repeat(Math.max(0, 5 - full - (half ? 1 : 0)))}`;
}

function StarPicker({
  value,
  onChange,
  ratings = [],
}: {
  value: number | null;
  onChange: (n: number) => void;
  ratings?: { user_id: number; username: string; stars: number }[];
}) {
  const rating = value ?? 0;
  const rated = ratings.filter((r) => r.stars > 0);

  const pick = (star: number, half: boolean) => {
    const next = half ? star - 0.5 : star;
    onChange(Math.abs(rating - next) < 0.001 ? 0 : next);
  };

  return (
    <div className="group/ratings relative" onPointerDown={stopDrag}>
      <div className="flex gap-0.5">
        {[1, 2, 3, 4, 5].map((star) => {
          const full = rating >= star;
          const half = !full && rating >= star - 0.5;
          const fillPct = full ? 100 : half ? 50 : 0;

          return (
            <div key={star} className="relative h-[18px] w-[18px] shrink-0">
              <Star className="absolute inset-0 h-[18px] w-[18px] text-slate-600" />
              {fillPct > 0 && (
                <div className="absolute inset-0 overflow-hidden" style={{ width: `${fillPct}%` }}>
                  <Star className="h-[18px] w-[18px] fill-amber-400 text-amber-400" />
                </div>
              )}
              <button
                type="button"
                aria-label={`Rate ${star - 0.5} stars`}
                title={`${star - 0.5} stars`}
                className="absolute inset-y-0 left-0 z-10 w-1/2"
                onClick={() => pick(star, true)}
              />
              <button
                type="button"
                aria-label={`Rate ${star} stars`}
                title={`${star} star${star > 1 ? "s" : ""}`}
                className="absolute inset-y-0 right-0 z-10 w-1/2"
                onClick={() => pick(star, false)}
              />
            </div>
          );
        })}
      </div>
      {rated.length > 0 && (
        <div className="pointer-events-none absolute bottom-full left-0 z-30 mb-1 hidden min-w-[10rem] max-w-xs rounded-lg border border-white/10 bg-ink-900 px-2.5 py-2 text-[10px] leading-relaxed text-slate-300 shadow-lg group-hover/ratings:block">
          <div className="mb-1 font-semibold text-slate-400">Everyone&apos;s ratings</div>
          {rated.map((r) => (
            <div key={r.user_id} className="flex items-center justify-between gap-3">
              <span>{r.username}</span>
              <span className="text-amber-400">{formatRating(r.stars)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ItemComments({ itemId, commentCount = 0 }: { itemId: number; commentCount?: number }) {
  const [open, setOpen] = useState(false);
  const [comments, setComments] = useState<{ id: number; body: string; username: string; created_at: string }[]>([]);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);

  const load = () => {
    setLoading(true);
    api
      .watchlistComments(itemId)
      .then((r) => setComments(r.comments))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    setOpen(false);
  }, [itemId]);

  useEffect(() => {
    if (open) load();
  }, [open, itemId]);

  const submit = async () => {
    if (!text.trim()) return;
    await api.watchlistAddComment(itemId, text.trim());
    setText("");
    setOpen(true);
    load();
  };

  return (
    <div className={open ? "w-full basis-full" : "shrink-0"}>
      <button type="button" onClick={() => setOpen(!open)} className="btn-ghost shrink-0 px-1 py-0.5 text-[11px]">
        <MessageSquare className="h-3 w-3" /> Comments{commentCount > 0 ? ` (${commentCount})` : ""}
      </button>
      {open && (
        <div className="mt-2 space-y-2 rounded-lg bg-black/20 p-2">
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin text-slate-500" />
          ) : comments.length === 0 ? (
            <p className="text-[11px] text-slate-500">No comments yet.</p>
          ) : (
            comments.map((c) => (
              <div key={c.id} className="text-xs">
                <span className="font-medium text-brand-300">{c.username}</span>
                <span className="text-slate-500"> · {new Date(c.created_at).toLocaleDateString()}</span>
                <p className="mt-0.5 text-slate-300">{c.body}</p>
              </div>
            ))
          )}
          <div className="flex gap-2">
            <input
              className="input flex-1 text-xs"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Add a comment…"
              onKeyDown={(e) => e.key === "Enter" && submit()}
            />
            <button type="button" onClick={submit} className="btn-primary px-2 text-xs">
              Post
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ItemOverview({ item, expanded = true }: { item: WatchlistItem; expanded?: boolean }) {
  const [overview, setOverview] = useState(item.overview || "");

  useEffect(() => {
    setOverview(item.overview || "");
    if (item.overview || !item.tmdb_id || item.kind === "episode") return;
    const type = item.kind === "series" ? "series" : "movie";
    api
      .titleDetails(item.tmdb_id, type)
      .then((d) => setOverview(d.overview || ""))
      .catch(() => {});
  }, [item.id, item.overview, item.tmdb_id, item.kind]);

  if (!expanded || !overview) return null;
  return <p className="mt-1 line-clamp-4 text-xs leading-relaxed text-slate-400">{overview}</p>;
}

type SeasonCatalogRow = {
  season_number: number;
  name: string;
  episode_count: number;
  on_watchlist: number;
};

function SeriesExpandedPanel({
  item,
  currentUserId,
  onUpdate,
  onParentRefresh,
  onRequestDelete,
  onFindStreams,
  onToast,
}: {
  item: WatchlistItem;
  currentUserId: number;
  onUpdate: (item: WatchlistItem) => void;
  onParentRefresh: () => void;
  onRequestDelete: (item: WatchlistItem) => void;
  onFindStreams: (target: StreamTarget) => void;
  onToast: (msg: string, kind?: "success" | "error" | "info") => void;
}) {
  const children = item.children ?? [];
  const [catalog, setCatalog] = useState<SeasonCatalogRow[]>([]);
  const [catalogSource, setCatalogSource] = useState<"tmdb" | "anime" | "watchlist_only">("watchlist_only");
  const [catalogTmdbId, setCatalogTmdbId] = useState<number | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState("");
  const [linkTmdbOpen, setLinkTmdbOpen] = useState(false);
  const [season, setSeason] = useState<number | null>(null);
  const [selectedSeasons, setSelectedSeasons] = useState<Set<number>>(new Set());
  const [tmdbEps, setTmdbEps] = useState<Map<number, TmdbEpisode>>(new Map());
  const [loadingEps, setLoadingEps] = useState(false);
  const [adding, setAdding] = useState(false);

  const loadCatalog = useCallback(() => {
    setCatalogLoading(true);
    setCatalogError("");
    api
      .watchlistSeasonCatalog(item.id)
      .then((r) => {
        setCatalog(r.seasons || []);
        setCatalogSource(r.catalog_source || "watchlist_only");
        setCatalogTmdbId(r.tmdb_id ?? null);
        if (r.seasons?.length) {
          setSeason((prev) =>
            prev != null && r.seasons.some((s) => s.season_number === prev)
              ? prev
              : r.seasons[0].season_number
          );
        } else {
          setSeason(null);
        }
      })
      .catch((err: unknown) => {
        setCatalog([]);
        setCatalogError(err instanceof Error ? err.message : "Could not load seasons");
      })
      .finally(() => setCatalogLoading(false));
  }, [item.id]);

  useEffect(() => {
    loadCatalog();
  }, [loadCatalog]);

  useEffect(() => {
    if (!item.tmdb_id || season == null) {
      setTmdbEps(new Map());
      return;
    }
    setLoadingEps(true);
    api
      .seasonEpisodes(item.tmdb_id, season)
      .then((r) => {
        const map = new Map<number, TmdbEpisode>();
        for (const ep of r.episodes) map.set(ep.episode_number, ep);
        setTmdbEps(map);
      })
      .catch(() => setTmdbEps(new Map()))
      .finally(() => setLoadingEps(false));
  }, [item.tmdb_id, season]);

  const epsInSeason = useMemo(
    () =>
      children
        .filter((c) => c.season === season)
        .sort((a, b) => (a.episode ?? 0) - (b.episode ?? 0)),
    [children, season]
  );

  const seasonRow = catalog.find((s) => s.season_number === season);
  const missingInSeason =
    seasonRow != null ? Math.max(0, seasonRow.episode_count - seasonRow.on_watchlist) : 0;

  const addSeasons = async (seasonNums: number[]) => {
    if (!seasonNums.length) return;
    setAdding(true);
    try {
      const res = await api.watchlistAddSeasons(item.id, seasonNums);
      onUpdate(res.series);
      onParentRefresh();
      onToast(
        res.added > 0
          ? `Added ${res.added} episode${res.added === 1 ? "" : "s"} to watchlist`
          : "All episodes in those seasons were already on the list",
        "success"
      );
      loadCatalog();
      setSelectedSeasons(new Set());
    } catch (err: unknown) {
      onToast(err instanceof Error ? err.message : "Could not add episodes", "error");
    } finally {
      setAdding(false);
    }
  };

  const toggleSeasonPick = (sn: number) => {
    setSelectedSeasons((prev) => {
      const next = new Set(prev);
      if (next.has(sn)) next.delete(sn);
      else next.add(sn);
      return next;
    });
  };

  return (
    <div className="ml-10 mt-3 space-y-3 border-l border-white/5 pl-3" onPointerDown={stopDrag}>
      <ItemOverview item={item} />

      {catalogLoading ? (
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading seasons…
        </div>
      ) : catalogError ? (
        <p className="text-xs text-amber-300">{catalogError}</p>
      ) : catalog.length === 0 ? (
        <p className="text-xs text-slate-500">
          No season list for this show (link TMDB or use a kitsu/mal/anilist id). Add episodes from Search.
        </p>
      ) : (
        <div className="space-y-3 rounded-lg border border-white/5 bg-black/20 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs font-medium text-slate-300">Add episodes to watchlist</div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="chip bg-white/5 text-slate-400">
                Seasons from {catalogSource === "tmdb" ? "TMDB" : catalogSource === "anime" ? "anime meta" : "list only"}
              </span>
              <button
                type="button"
                className="btn-ghost py-0.5 text-[10px]"
                onClick={() => setLinkTmdbOpen(true)}
              >
                <Link2 className="h-3 w-3" /> Link TMDB catalog
              </button>
            </div>
          </div>
          {catalogSource === "anime" && (
            <p className="text-[10px] text-slate-500">
              Anime meta may only list one season. Link TMDB to bulk-add all seasons and episodes.
              {catalogTmdbId ? ` (TMDB #${catalogTmdbId} also set — refresh if seasons look wrong.)` : ""}
            </p>
          )}

          <div className="flex flex-wrap items-end gap-2">
            <label className="block min-w-[10rem] flex-1 text-xs text-slate-400">
              Season
              <select
                className="input mt-1 w-full"
                value={season ?? ""}
                onChange={(e) => setSeason(Number(e.target.value) || null)}
              >
                {catalog.map((s) => (
                  <option key={s.season_number} value={s.season_number}>
                    {s.name} · {s.episode_count} eps
                    {s.on_watchlist > 0 ? ` (${s.on_watchlist} on list)` : ""}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              disabled={adding || season == null || missingInSeason === 0}
              onClick={() => season != null && addSeasons([season])}
              className="btn-primary shrink-0 text-xs"
            >
              {adding ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <>
                  <ListPlus className="h-3.5 w-3.5" /> Add season
                </>
              )}
            </button>
          </div>
          {seasonRow && missingInSeason === 0 && seasonRow.episode_count > 0 && (
            <p className="text-[10px] text-slate-500">Every episode in this season is already on your watchlist.</p>
          )}
          {seasonRow && missingInSeason > 0 && (
            <p className="text-[10px] text-slate-500">
              Adds {missingInSeason} missing episode{missingInSeason === 1 ? "" : "s"} from this season.
            </p>
          )}

          {catalog.length > 1 && (
            <div className="space-y-2 border-t border-white/5 pt-2">
              <div className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
                Or add multiple seasons
              </div>
              <div className="flex flex-wrap gap-2">
                {catalog.map((s) => (
                  <label
                    key={s.season_number}
                    className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-white/10 px-2 py-1 text-xs text-slate-300 hover:bg-white/5"
                  >
                    <input
                      type="checkbox"
                      checked={selectedSeasons.has(s.season_number)}
                      onChange={() => toggleSeasonPick(s.season_number)}
                      className="h-3.5 w-3.5 rounded accent-brand-500"
                    />
                    {s.name}
                    <span className="text-slate-500">({s.episode_count})</span>
                  </label>
                ))}
              </div>
              <button
                type="button"
                disabled={adding || selectedSeasons.size === 0}
                onClick={() => addSeasons([...selectedSeasons])}
                className="btn-ghost border border-white/10 text-xs"
              >
                <ListPlus className="h-3.5 w-3.5" /> Add {selectedSeasons.size} selected season
                {selectedSeasons.size === 1 ? "" : "s"}
              </button>
            </div>
          )}
        </div>
      )}

      {children.length === 0 ? (
        <p className="px-2 py-1 text-xs text-slate-500">No episodes on the watchlist yet — use Add season above.</p>
      ) : (
        <>
          {loadingEps && item.tmdb_id && (
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading episode details…
            </div>
          )}

          <div className="grid gap-2 sm:grid-cols-2">
            {epsInSeason.map((ep) => (
              <EpisodeRow
                key={ep.id}
                item={ep}
                meta={ep.episode != null ? tmdbEps.get(ep.episode) : undefined}
                currentUserId={currentUserId}
                onUpdate={onUpdate}
                onParentRefresh={onParentRefresh}
                onRequestDelete={onRequestDelete}
                onFindStreams={onFindStreams}
              />
            ))}
          </div>
          {season != null && epsInSeason.length === 0 && (
            <p className="text-xs text-slate-500">No episodes from this season on the list yet.</p>
          )}
        </>
      )}

      {linkTmdbOpen && (
        <LinkWatchlistTmdbModal
          item={item}
          onClose={() => setLinkTmdbOpen(false)}
          onLinked={(updated) => {
            onUpdate(updated);
            onParentRefresh();
            loadCatalog();
            onToast("TMDB catalog linked — season list updated", "success");
          }}
        />
      )}
    </div>
  );
}

function CollectionMemberRow({
  item,
  currentUserId,
  onUpdate,
  onParentRefresh,
  onRequestDelete,
  onFindStreams,
}: {
  item: WatchlistItem;
  currentUserId: number;
  onUpdate: (item: WatchlistItem) => void;
  onParentRefresh: () => void;
  onRequestDelete: (item: WatchlistItem) => void;
  onFindStreams: (target: StreamTarget) => void;
}) {
  const toggleWatched = async () => {
    const next = await api.watchlistSetWatched(item.id, !item.my_watched);
    onUpdate(next);
    onParentRefresh();
  };

  const setRating = async (stars: number) => {
    const next = await api.watchlistSetRating(item.id, stars);
    onUpdate(next);
  };

  const streamTarget = streamTargetFromWatchlistItem(item);

  return (
    <div className="card flex gap-3 p-2">
      {item.poster ? (
        <img src={item.poster} alt="" className="h-14 w-10 shrink-0 rounded object-cover" />
      ) : (
        <div className="h-14 w-10 shrink-0 rounded bg-ink-800" />
      )}
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-xs font-medium">
              {item.title}
              {item.year && <span className="text-slate-500"> ({item.year})</span>}
            </div>
            <span className="chip mt-0.5 bg-white/5 text-slate-400">{item.kind}</span>
          </div>
          <button
            type="button"
            onClick={() => onRequestDelete(item)}
            onPointerDown={stopDrag}
            className="shrink-0 text-red-400"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
        <UserWatchBadges
          users={item.user_watch ?? []}
          currentUserId={currentUserId}
          onToggleSelf={toggleWatched}
          compact
        />
        <div className="flex flex-wrap items-center gap-2">
          <StarPicker value={item.my_rating} onChange={setRating} ratings={item.ratings ?? []} />
          <TitleMediaActions
            compact
            onFindStreams={streamTarget ? () => onFindStreams(streamTarget) : undefined}
            libraryMatch={item.library_match}
            onPointerDown={stopDrag}
          />
          <ItemComments itemId={item.id} commentCount={item.comment_count} />
        </div>
      </div>
    </div>
  );
}

function CollectionExpandedPanel({
  item,
  currentUserId,
  onUpdate,
  onParentRefresh,
  onRequestDelete,
  onFindStreams,
  onToast,
}: {
  item: WatchlistItem;
  currentUserId: number;
  onUpdate: (item: WatchlistItem) => void;
  onParentRefresh: () => void;
  onRequestDelete: (item: WatchlistItem) => void;
  onFindStreams: (target: StreamTarget) => void;
  onToast: (msg: string, kind?: "success" | "error" | "info") => void;
}) {
  const children = item.children ?? [];
  const [expandedSeries, setExpandedSeries] = useState<Set<number>>(new Set());

  const toggleSeries = (id: number) => {
    setExpandedSeries((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="ml-6 mt-2 space-y-2 border-l border-white/10 pl-3">
      {children.length === 0 && (
        <p className="text-xs text-slate-500">No titles in this collection yet.</p>
      )}
      {children.map((child) =>
        child.kind === "series" ? (
          <div key={child.id} className="space-y-2">
            <div className="card flex gap-2 p-2">
              <button
                type="button"
                onClick={() => toggleSeries(child.id)}
                onPointerDown={stopDrag}
                className="mt-0.5 text-slate-400 hover:text-white"
              >
                {expandedSeries.has(child.id) ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
              </button>
              {child.poster ? (
                <img src={child.poster} alt="" className="h-12 w-9 shrink-0 rounded object-cover" />
              ) : (
                <div className="h-12 w-9 shrink-0 rounded bg-ink-800" />
              )}
              <div className="min-w-0 flex-1">
                <div className="text-xs font-medium">{child.title}</div>
                <div className="mt-0.5 flex flex-wrap gap-1">
                  <span className="chip bg-white/5 text-slate-400">series</span>
                  {child.my_episode_progress && (
                    <span className="chip bg-brand-500/15 text-brand-300">You: {child.my_episode_progress} eps</span>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => onRequestDelete(child)}
                onPointerDown={stopDrag}
                className="shrink-0 text-red-400"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
            {expandedSeries.has(child.id) && (
              <SeriesExpandedPanel
                item={child}
                currentUserId={currentUserId}
                onUpdate={onUpdate}
                onParentRefresh={onParentRefresh}
                onRequestDelete={onRequestDelete}
                onFindStreams={onFindStreams}
                onToast={onToast}
              />
            )}
          </div>
        ) : (
          <CollectionMemberRow
            key={child.id}
            item={child}
            currentUserId={currentUserId}
            onUpdate={onUpdate}
            onParentRefresh={onParentRefresh}
            onRequestDelete={onRequestDelete}
            onFindStreams={onFindStreams}
          />
        )
      )}
    </div>
  );
}

function SortableRow({
  item,
  groups,
  currentUserId,
  isAdmin,
  onUpdate,
  onRequestDelete,
  onRemoveFromView,
  onRefresh,
  expanded,
  onToggleExpand,
  onFindStreams,
  onToast,
}: {
  item: WatchlistItem;
  groups: WatchlistGroup[];
  currentUserId: number;
  isAdmin: boolean;
  onUpdate: (item: WatchlistItem) => void;
  onRequestDelete: (item: WatchlistItem) => void;
  onRemoveFromView: (id: number) => void;
  onRefresh: () => void;
  expanded?: boolean;
  onToggleExpand?: () => void;
  onFindStreams: (target: StreamTarget) => void;
  onToast: (msg: string, kind?: "success" | "error" | "info") => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };

  const toggleWatched = async () => {
    const next = await api.watchlistSetWatched(item.id, !item.my_watched);
    onUpdate(next);
    onRemoveFromView(item.id);
    onRefresh();
  };

  const setRating = async (stars: number) => {
    const next = await api.watchlistSetRating(item.id, stars);
    onUpdate(next);
  };

  const isContainer = item.kind === "series" || item.kind === "collection";
  const progressLabel = item.kind === "collection" ? "items" : "eps";
  const streamTarget = streamTargetFromWatchlistItem(item);

  return (
    <div ref={setNodeRef} style={style} className="card p-2.5 sm:p-3">
      <div className="flex gap-2 sm:gap-3">
        <button type="button" className="cursor-grab text-slate-500 max-sm:mt-1" {...attributes} {...listeners}>
          <GripVertical className="h-4 w-4" />
        </button>
        {item.poster ? (
          <img src={item.poster} alt="" className="h-14 w-10 sm:h-16 sm:w-11 shrink-0 rounded object-cover" />
        ) : (
          <div className="h-14 w-10 sm:h-16 sm:w-11 shrink-0 rounded bg-ink-800" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            {isContainer && onToggleExpand && (
              <button
                type="button"
                onClick={onToggleExpand}
                onPointerDown={stopDrag}
                className="mt-0.5 text-slate-400 hover:text-white"
              >
                {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </button>
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 truncate text-sm font-medium">
                <span className="truncate">
                  {item.title}
                  {item.year && <span className="text-slate-500"> ({item.year})</span>}
                </span>
                <NeedsRatingBadge count={item.my_unrated_count ?? 0} className="shrink-0" />
              </div>
              <div className="mt-0.5 flex flex-wrap gap-1">
                <span className="chip bg-white/5 text-slate-400">{item.kind}</span>
                {item.my_episode_progress && (
                  <span className="chip bg-brand-500/15 text-brand-300">
                    You: {item.my_episode_progress} {progressLabel}
                  </span>
                )}
                {item.group_episode_progress && isContainer && (
                  <span className="chip bg-white/5 text-slate-400">
                    Group: {item.group_episode_progress} {progressLabel}
                  </span>
                )}
                {item.library_match && <InLibraryChip />}
                {item.everyone_watched && (
                  <span className="chip bg-emerald-500/15 text-emerald-300">everyone watched</span>
                )}
                {item.group_watch_progress && !item.everyone_watched && isContainer && (
                  <span className="chip bg-white/5 text-slate-400">{item.group_watch_progress} watched show</span>
                )}
              </div>
              <UserWatchBadges
                users={item.user_watch ?? []}
                currentUserId={currentUserId}
                onToggleSelf={toggleWatched}
              />
              {item.kind === "movie" || item.kind === "collection" ? <ItemOverview item={item} /> : null}
            </div>
          </div>
          <div className="mt-2 space-y-2">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
              {item.kind !== "episode" && (
                <StarPicker value={item.my_rating} onChange={setRating} ratings={item.ratings ?? []} />
              )}
              <TitleMediaActions
                libraryMatch={item.library_match}
                hideLibraryChip
                onFindStreams={
                  streamTarget && item.kind !== "episode" && item.kind !== "collection"
                    ? () => onFindStreams(streamTarget)
                    : undefined
                }
                onPointerDown={stopDrag}
              />
            </div>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
              <ItemComments itemId={item.id} commentCount={item.comment_count} />
              {isAdmin && item.kind !== "episode" && (
                <StatsExclusionMenu item={item} onUpdate={onUpdate} />
              )}
              {item.kind !== "episode" && (
                <GroupMoveSelect
                  item={item}
                  groups={groups}
                  onMoved={() => {
                    onRemoveFromView(item.id);
                    onRefresh();
                  }}
                />
              )}
              <button
                type="button"
                onClick={() => onRequestDelete(item)}
                className="btn-ghost shrink-0 px-1 py-0.5 text-red-400"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          </div>
        </div>
      </div>
      {item.kind === "series" && expanded && (
        <SeriesExpandedPanel
          item={item}
          currentUserId={currentUserId}
          onUpdate={onUpdate}
          onParentRefresh={onRefresh}
          onRequestDelete={onRequestDelete}
          onFindStreams={onFindStreams}
          onToast={onToast}
        />
      )}
      {item.kind === "collection" && expanded && (
        <CollectionExpandedPanel
          item={item}
          currentUserId={currentUserId}
          onUpdate={onUpdate}
          onParentRefresh={onRefresh}
          onRequestDelete={onRequestDelete}
          onFindStreams={onFindStreams}
          onToast={onToast}
        />
      )}
    </div>
  );
}

function EpisodeRow({
  item,
  meta,
  currentUserId,
  onUpdate,
  onParentRefresh,
  onRequestDelete,
  onFindStreams,
}: {
  item: WatchlistItem;
  meta?: TmdbEpisode;
  currentUserId: number;
  onUpdate: (item: WatchlistItem) => void;
  onParentRefresh: () => void;
  onRequestDelete: (item: WatchlistItem) => void;
  onFindStreams: (target: StreamTarget) => void;
}) {
  const toggleWatched = async () => {
    const next = await api.watchlistSetWatched(item.id, !item.my_watched);
    onUpdate(next);
    onParentRefresh();
  };

  const setRating = async (stars: number) => {
    const next = await api.watchlistSetRating(item.id, stars);
    onUpdate(next);
  };

  const still = item.poster || meta?.still || "";
  const overview = item.overview || meta?.overview || "";
  const airDate = item.air_date || meta?.air_date || "";
  const epTitle = meta?.name && meta.name !== item.title ? meta.name : item.title.replace(/^.*?—\s*/, "");
  const streamTarget = streamTargetFromWatchlistItem(item);

  return (
    <div className="card flex gap-3 p-2">
      {still ? (
        <img src={still} alt="" className="h-14 w-24 shrink-0 rounded object-cover" />
      ) : (
        <div className="grid h-14 w-24 shrink-0 place-items-center rounded bg-ink-800 text-xs text-slate-500">
          E{item.episode}
        </div>
      )}
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-xs font-medium">
              {item.episode}. {epTitle}
              <NeedsRatingBadge count={item.my_unrated_count ?? 0} className="ml-1 align-middle" />
            </div>
            {airDate && <div className="text-[10px] text-slate-500">{airDate}</div>}
            {overview && <p className="mt-0.5 line-clamp-2 text-[10px] leading-snug text-slate-400">{overview}</p>}
          </div>
          <button
            type="button"
            onClick={() => onRequestDelete(item)}
            onPointerDown={stopDrag}
            className="shrink-0 text-red-400"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
        <UserWatchBadges
          users={item.user_watch ?? []}
          currentUserId={currentUserId}
          onToggleSelf={toggleWatched}
          compact
        />
        <div className="flex flex-wrap items-center gap-2">
          <StarPicker value={item.my_rating} onChange={setRating} ratings={item.ratings ?? []} />
          <TitleMediaActions
            compact
            onFindStreams={streamTarget ? () => onFindStreams(streamTarget) : undefined}
            libraryMatch={item.library_match}
            onPointerDown={stopDrag}
          />
          <ItemComments itemId={item.id} commentCount={item.comment_count} />
        </div>
      </div>
    </div>
  );
}

export function Watchlist({
  user,
  refreshVersion = 0,
  initialGroupId,
  section,
  onGroupChange,
  onSectionChange,
  onGoToQueue,
}: {
  user: UserInfo;
  refreshVersion?: number;
  initialGroupId?: number;
  section: "to_watch" | "watched";
  onGroupChange?: (groupId: number) => void;
  onSectionChange?: (section: "to_watch" | "watched") => void;
  onGoToQueue?: () => void;
}) {
  const { push: pushToast } = useToast();
  const { obs } = usePlayback();
  const [groups, setGroups] = useState<WatchlistGroup[]>([]);
  const [ungroupedCounts, setUngroupedCounts] = useState({ to_watch: 0, watched: 0, needs_rating: 0 });
  const [selectedGroupId, setSelectedGroupId] = useState<number>(initialGroupId ?? 0);
  const [groupQueueBusy, setGroupQueueBusy] = useState(false);
  const [items, setItems] = useState<WatchlistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [newGroupName, setNewGroupName] = useState("");
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [deleteTarget, setDeleteTarget] = useState<WatchlistItem | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [wheelOpen, setWheelOpen] = useState(false);
  const [streamTarget, setStreamTarget] = useState<StreamTarget | null>(null);
  const [error, setError] = useState("");
  const [itemFilter, setItemFilter] = useState("");
  const [watchedSort, setWatchedSort] = useState<WatchedSort>("needs_rating");
  const [watcherFilter, setWatcherFilter] = useState<"any" | "not_me" | number>("any");
  const loadItemsSeqRef = useRef(0);
  const loadItemsRef = useRef<() => void>(() => {});

  const watcherOptions = useMemo(() => {
    const byId = new Map<number, string>();
    for (const item of items) {
      for (const w of item.user_watch ?? []) {
        if (!byId.has(w.user_id)) byId.set(w.user_id, w.username);
      }
    }
    return Array.from(byId.entries())
      .map(([user_id, username]) => ({ user_id, username }))
      .sort((a, b) => a.username.localeCompare(b.username, undefined, { sensitivity: "base" }));
  }, [items]);

  const filteredItems = useMemo(() => {
    const q = itemFilter.trim().toLowerCase();
    let list = q
      ? items.filter((item) => {
          const haystack = [item.title, item.year].filter(Boolean).join(" ").toLowerCase();
          return haystack.includes(q);
        })
      : items;
    if (watcherFilter !== "any") {
      list = list.filter((item) => {
        const watch = item.user_watch ?? [];
        if (watcherFilter === "not_me") {
          const mine = watch.find((w) => w.user_id === user.id);
          return !mine || !mine.watched;
        }
        const entry = watch.find((w) => w.user_id === watcherFilter);
        return !!entry?.watched;
      });
    }
    if (section === "watched") {
      list = sortWatchedItems(list, watchedSort);
    }
    return list;
  }, [items, itemFilter, section, watchedSort, watcherFilter, user.id]);

  const applyCounts = useCallback(
    (groupId: number, counts: { to_watch: number; watched: number; needs_rating?: number }) => {
      const normalized = {
        to_watch: counts.to_watch,
        watched: counts.watched,
        needs_rating: counts.needs_rating ?? 0,
      };
      if (groupId === 0) {
        setUngroupedCounts(normalized);
      } else {
        setGroups((prev) => prev.map((g) => (g.id === groupId ? { ...g, counts: normalized } : g)));
      }
    },
    []
  );

  const loadGroups = useCallback(() => {
    api
      .watchlistGroups()
      .then((r) => {
        setGroups(r.groups);
        setUngroupedCounts({
          to_watch: r.ungrouped_counts.to_watch,
          watched: r.ungrouped_counts.watched,
          needs_rating: r.ungrouped_counts.needs_rating ?? 0,
        });
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Could not load watchlist groups");
      });
  }, []);

  const loadItems = useCallback(() => {
    const seq = ++loadItemsSeqRef.current;
    setLoading(true);
    api
      .watchlistGroupItems(selectedGroupId, section)
      .then((r) => {
        if (seq !== loadItemsSeqRef.current) return;
        setItems(r.items);
        if (r.counts) applyCounts(selectedGroupId, r.counts);
      })
      .catch((e) => {
        if (seq !== loadItemsSeqRef.current) return;
        setError(e.message);
      })
      .finally(() => {
        if (seq !== loadItemsSeqRef.current) return;
        setLoading(false);
      });
  }, [selectedGroupId, section, applyCounts]);

  useEffect(() => {
    loadItemsRef.current = loadItems;
  }, [loadItems]);

  useEffect(() => {
    loadGroups();
  }, [loadGroups]);

  useEffect(() => {
    if (initialGroupId != null) setSelectedGroupId(initialGroupId);
  }, [initialGroupId]);

  const pickGroup = (id: number) => {
    setSelectedGroupId(id);
    setItemFilter("");
    onGroupChange?.(id);
  };

  const pickSection = (next: "to_watch" | "watched") => {
    onSectionChange?.(next);
  };

  useEffect(() => {
    setItemFilter("");
  }, [section, selectedGroupId]);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  useEffect(() => {
    if (refreshVersion > 0) {
      loadGroups();
      loadItemsRef.current();
    }
  }, [refreshVersion, loadGroups]);

  const createGroup = async () => {
    if (!newGroupName.trim()) return;
    try {
      await api.watchlistCreateGroup(newGroupName.trim());
      setNewGroupName("");
      loadGroups();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not create group");
    }
  };

  const createGroupFromTemplate = async (name: string) => {
    if (!name) return;
    try {
      await api.watchlistCreateGroup(name);
      pushToast(`Created group "${name}"`, "success");
      loadGroups();
    } catch (err: unknown) {
      pushToast(err instanceof Error ? err.message : "Could not create group", "error");
    }
  };

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIdx = items.findIndex((i) => i.id === active.id);
    const newIdx = items.findIndex((i) => i.id === over.id);
    if (oldIdx < 0 || newIdx < 0) return;
    const prev = items;
    const next = arrayMove(items, oldIdx, newIdx);
    setItems(next);
    api
      .watchlistReorder(next.map((it, idx) => ({ id: it.id, sort_order: idx, group_id: selectedGroupId || null })))
      .catch((err: unknown) => {
        setItems(prev);
        setError(err instanceof Error ? err.message : "Could not reorder watchlist");
      });
  };

  const updateItem = (updated: WatchlistItem) => {
    setItems((prev) =>
      prev.map((it) => {
        if (it.id === updated.id) return updated;
        if (it.children) {
          return { ...it, children: it.children.map((c) => (c.id === updated.id ? updated : c)) };
        }
        return it;
      })
    );
  };

  const refreshItems = () => {
    api
      .watchlistGroupItems(selectedGroupId, section)
      .then((r) => {
        setItems(r.items);
        if (r.counts) applyCounts(selectedGroupId, r.counts);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Could not refresh watchlist");
      });
    loadGroups();
  };

  const removeFromView = (id: number) => {
    setItems((prev) =>
      prev
        .filter((it) => it.id !== id)
        .map((it) =>
          it.children ? { ...it, children: it.children.filter((c) => c.id !== id) } : it
        )
    );
  };

  const requestDelete = (item: WatchlistItem) => setDeleteTarget(item);

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleteBusy(true);
    try {
      await api.watchlistDeleteItem(deleteTarget.id);
      removeFromView(deleteTarget.id);
      loadGroups();
      setDeleteTarget(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setDeleteBusy(false);
    }
  };

  const spinWheel = () => setWheelOpen(true);

  const queueUnwatchedInGroup = async () => {
    setGroupQueueBusy(true);
    try {
      const r = await api.watchlistQueueUnwatched(selectedGroupId);
      if (r.added === 0) {
        pushToast(
          r.eligible === 0
            ? "No unwatched in-library titles in this group"
            : "Could not add titles to queue",
          "info"
        );
      } else {
        pushToast(`Added ${r.added} title${r.added === 1 ? "" : "s"} to queue`, "success", onGoToQueue
          ? { label: "Open Queue", onClick: onGoToQueue }
          : undefined);
      }
    } catch (err: unknown) {
      pushToast(err instanceof Error ? err.message : "Queue failed", "error");
    } finally {
      setGroupQueueBusy(false);
    }
  };

  const playNextUnwatched = async () => {
    setGroupQueueBusy(true);
    try {
      const r = await api.watchlistPlayNextUnwatched(selectedGroupId);
      pushToast(`Now playing: ${r.title}`, "success", onGoToQueue
        ? { label: "Open Queue", onClick: onGoToQueue }
        : undefined);
      if (!obs.connected) {
        pushToast("OBS is offline — friends won't see playback in VRChat.", "error");
      } else if (!obs.streaming) {
        pushToast("Click Go live on Queue & Player so friends can watch.", "info");
      }
    } catch (err: unknown) {
      pushToast(err instanceof Error ? err.message : "Nothing to play", "error");
    } finally {
      setGroupQueueBusy(false);
    }
  };

  const selectedGroup = groups.find((g) => g.id === selectedGroupId);
  const wheelGroupName = selectedGroupId === 0 ? "Ungrouped" : selectedGroup?.name ?? "Group";
  const counts =
    selectedGroupId === 0 ? ungroupedCounts : selectedGroup?.counts ?? { to_watch: 0, watched: 0, needs_rating: 0 };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Watchlist</h1>
        <p className="mt-1 text-sm text-slate-400">
          Signed in as {user.username}. Mark your badge to move titles between your To Watch and Watched tabs.
        </p>
      </div>

      {error && (
        <div className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300" onClick={() => setError("")}>
          {error}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,220px)_1fr]">
        <div className="card p-3 lg:space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Groups</div>
          <p className="hidden text-[10px] text-slate-600 lg:block">Sidebar: to watch · watched</p>
          <div className="flex gap-2 overflow-x-auto pb-1 lg:block lg:space-y-2 lg:overflow-visible">
          <button
            type="button"
            onClick={() => pickGroup(0)}
            className={`shrink-0 rounded-lg px-3 py-2 text-left text-sm lg:w-full ${
              selectedGroupId === 0 ? "bg-brand-500/15 text-white" : "hover:bg-white/5 text-slate-300"
            }`}
          >
            Ungrouped
            <span className="ml-2 text-[10px] text-slate-500 lg:float-right">
              {ungroupedCounts.to_watch} ·{" "}
              <WatchedCountWithBadge
                watched={ungroupedCounts.watched}
                needsRating={ungroupedCounts.needs_rating}
              />
            </span>
          </button>
          {groups.map((g) => (
            <button
              key={g.id}
              type="button"
              onClick={() => pickGroup(g.id)}
              className={`shrink-0 rounded-lg px-3 py-2 text-left text-sm lg:w-full ${
                selectedGroupId === g.id ? "bg-brand-500/15 text-white" : "hover:bg-white/5 text-slate-300"
              }`}
            >
              {g.name}
              <span className="ml-2 text-[10px] text-slate-500 lg:float-right">
                {g.counts.to_watch} ·{" "}
                <WatchedCountWithBadge
                  watched={g.counts.watched}
                  needsRating={g.counts.needs_rating ?? 0}
                />
              </span>
            </button>
          ))}
          </div>
          <div className="flex gap-1 pt-2">
            <input
              className="input flex-1 text-xs"
              placeholder="New group…"
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && createGroup()}
            />
            <button type="button" onClick={createGroup} className="btn-primary px-2">
              <Plus className="h-4 w-4" />
            </button>
          </div>
          <select
            className="input mt-1 text-xs"
            value=""
            onChange={(e) => {
              const name = e.target.value;
              e.target.value = "";
              createGroupFromTemplate(name);
            }}
          >
            <option value="">From template…</option>
            {GROUP_TEMPLATES.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => pickSection("to_watch")}
              className={section === "to_watch" ? "btn-primary" : "btn-ghost"}
            >
              To Watch ({counts.to_watch})
            </button>
            <button
              type="button"
              onClick={() => pickSection("watched")}
              className={section === "watched" ? "btn-primary" : "btn-ghost"}
            >
              <span className="inline-flex items-center gap-1.5">
                Watched (
                <WatchedCountWithBadge watched={counts.watched} needsRating={counts.needs_rating ?? 0} />)
              </span>
            </button>
            {(selectedGroupId === 0 || selectedGroup?.wheel_enabled !== false) && section === "to_watch" && (
              <button type="button" onClick={spinWheel} className="btn-ghost ml-auto">
                <RotateCw className="h-4 w-4" /> Wheel spin
              </button>
            )}
          </div>

          <div className="space-y-1">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <input
                value={itemFilter}
                onChange={(e) => setItemFilter(e.target.value)}
                placeholder="Filter titles in this group…"
                className="input w-full pl-10 text-sm"
              />
              {itemFilter && (
                <button
                  type="button"
                  onClick={() => setItemFilter("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:bg-white/5 hover:text-white"
                  title="Clear filter"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            {itemFilter.trim() && (
              <p className="text-xs text-slate-500">
                Showing {filteredItems.length} of {items.length}
              </p>
            )}
          </div>

          <label className="flex w-full flex-wrap items-center gap-2 text-xs text-slate-400 sm:w-auto">
            <span className="shrink-0">Watched by</span>
            <select
              className="input max-w-full py-1 text-xs sm:max-w-[14rem]"
              value={String(watcherFilter)}
              onChange={(e) => {
                const v = e.target.value;
                if (v === "any" || v === "not_me") setWatcherFilter(v);
                else setWatcherFilter(Number(v));
              }}
            >
              <option value="any">Anyone</option>
              <option value="not_me">Not me</option>
              {watcherOptions.map((u) => (
                <option key={u.user_id} value={u.user_id}>
                  {u.username}
                </option>
              ))}
            </select>
          </label>

          {section === "watched" && (
            <label className="flex w-full flex-wrap items-center gap-2 text-xs text-slate-400 sm:w-auto">
              <span className="shrink-0">Sort</span>
              <select
                className="input max-w-full py-1 text-xs sm:max-w-[14rem]"
                value={watchedSort}
                onChange={(e) => setWatchedSort(e.target.value as WatchedSort)}
              >
                <option value="needs_rating">{watchedSortLabel("needs_rating")}</option>
                <option value="recent">{watchedSortLabel("recent")}</option>
                <option value="oldest">{watchedSortLabel("oldest")}</option>
                <option value="title">{watchedSortLabel("title")}</option>
              </select>
              {(counts.needs_rating ?? 0) > 0 && (
                <span className="text-amber-300/90">
                  {counts.needs_rating} not rated yet
                </span>
              )}
            </label>
          )}

          {section === "to_watch" && (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={groupQueueBusy}
                onClick={queueUnwatchedInGroup}
                className="btn-ghost text-xs"
              >
                {groupQueueBusy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <ListPlus className="h-3.5 w-3.5" />
                )}
                Add unwatched in library to queue
              </button>
              <button
                type="button"
                disabled={groupQueueBusy}
                onClick={playNextUnwatched}
                className="btn-ghost text-xs"
              >
                {groupQueueBusy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Play className="h-3.5 w-3.5" />
                )}
                Play next unwatched
              </button>
            </div>
          )}

          {loading ? (
            <div className="flex items-center gap-2 py-12 text-slate-400">
              <Loader2 className="h-5 w-5 animate-spin" /> Loading…
            </div>
          ) : items.length === 0 ? (
            <div className="py-12 text-center text-sm text-slate-500">
              Nothing here yet. Add titles from Search or Browse.
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="py-12 text-center text-sm text-slate-500">
              {itemFilter.trim() ? <>No titles match &ldquo;{itemFilter.trim()}&rdquo;.</> : "No titles match the current filters."}
            </div>
          ) : (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
              <SortableContext items={filteredItems.map((i) => i.id)} strategy={verticalListSortingStrategy}>
                <div className="space-y-2">
                  {filteredItems.map((item) => (
                    <SortableRow
                      key={item.id}
                      item={item}
                      groups={groups}
                      currentUserId={user.id}
                      isAdmin={user.role === "admin"}
                      onUpdate={updateItem}
                      onRequestDelete={requestDelete}
                      onRemoveFromView={removeFromView}
                      onRefresh={refreshItems}
                      expanded={expanded.has(item.id)}
                      onFindStreams={setStreamTarget}
                      onToast={pushToast}
                      onToggleExpand={
                        item.kind === "series" || item.kind === "collection"
                          ? () =>
                              setExpanded((prev) => {
                                const next = new Set(prev);
                                if (next.has(item.id)) next.delete(item.id);
                                else next.add(item.id);
                                return next;
                              })
                          : undefined
                      }
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}
        </div>
      </div>

      <WheelSpinModal
        open={wheelOpen}
        groupId={selectedGroupId}
        groupName={wheelGroupName}
        onClose={() => setWheelOpen(false)}
        onFindStreams={setStreamTarget}
      />

      <TitleStreamsModal
        open={!!streamTarget}
        target={streamTarget}
        onClose={() => setStreamTarget(null)}
        allowLocalDownload={canLocalDownload(user)}
      />

      {deleteTarget && (
        <DeleteConfirmModal
          item={deleteTarget}
          busy={deleteBusy}
          onCancel={() => !deleteBusy && setDeleteTarget(null)}
          onConfirm={confirmDelete}
        />
      )}
    </div>
  );
}
