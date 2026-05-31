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
  ListPlus,
  Loader2,
  MessageSquare,
  Play,
  Plus,
  RotateCw,
  Star,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../api";
import type { TmdbEpisode, UserInfo, WatchlistGroup, WatchlistItem, WatchlistUserWatch } from "../types";
import { streamTargetFromWatchlistItem, type StreamTarget } from "./streamTarget";
import { InLibraryChip } from "./InLibraryChip";
import { TitleMediaActions } from "./TitleMediaActions";
import { TitleStreamsModal } from "./TitleStreamsModal";
import { WheelSpinModal } from "./WheelSpinModal";
import { usePlayback } from "./PlaybackContext";
import { useToast } from "./Toast";

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
    <label className="flex items-center gap-1 text-[11px] text-slate-400" onPointerDown={stopDrag}>
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
  const [open, setOpen] = useState(commentCount > 0);
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
    setOpen(commentCount > 0);
  }, [itemId, commentCount]);

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
    <div className="min-w-0 flex-1">
      <button type="button" onClick={() => setOpen(!open)} className="btn-ghost px-1 py-0.5 text-[11px]">
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

function SeriesExpandedPanel({
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
  const children = item.children ?? [];
  const seasons = useMemo(() => {
    const counts = new Map<number, number>();
    for (const c of children) {
      if (c.season != null) counts.set(c.season, (counts.get(c.season) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort(([a], [b]) => a - b)
      .map(([season_number, episode_count]) => ({
        season_number,
        episode_count,
        name: `Season ${season_number}`,
      }));
  }, [children]);

  const [season, setSeason] = useState<number | null>(null);
  const [tmdbEps, setTmdbEps] = useState<Map<number, TmdbEpisode>>(new Map());
  const [loadingEps, setLoadingEps] = useState(false);

  useEffect(() => {
    if (seasons.length === 0) {
      setSeason(null);
      return;
    }
    setSeason((prev) => (prev != null && seasons.some((s) => s.season_number === prev) ? prev : seasons[0].season_number));
  }, [seasons, item.id]);

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

  return (
    <div className="ml-10 mt-3 space-y-3 border-l border-white/5 pl-3" onPointerDown={stopDrag}>
      <ItemOverview item={item} />

      {children.length === 0 ? (
        <p className="px-2 py-1 text-xs text-slate-500">No episodes on the watchlist yet.</p>
      ) : (
        <>
          <label className="block text-xs text-slate-400">
            Season
            <select
              className="input mt-1 w-full max-w-xs"
              value={season ?? ""}
              onChange={(e) => setSeason(Number(e.target.value) || null)}
            >
              {seasons.map((s) => (
                <option key={s.season_number} value={s.season_number}>
                  {s.name} ({s.episode_count} eps)
                </option>
              ))}
            </select>
          </label>

          {loadingEps && (
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading episode details…
            </div>
          )}

          {!loadingEps && epsInSeason.length === 0 && (
            <p className="text-xs text-slate-500">No episodes tracked for this season.</p>
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
        </>
      )}
    </div>
  );
}

function SortableRow({
  item,
  groups,
  currentUserId,
  onUpdate,
  onRequestDelete,
  onRemoveFromView,
  onRefresh,
  expanded,
  onToggleExpand,
  onFindStreams,
}: {
  item: WatchlistItem;
  groups: WatchlistGroup[];
  currentUserId: number;
  onUpdate: (item: WatchlistItem) => void;
  onRequestDelete: (item: WatchlistItem) => void;
  onRemoveFromView: (id: number) => void;
  onRefresh: () => void;
  expanded?: boolean;
  onToggleExpand?: () => void;
  onFindStreams: (target: StreamTarget) => void;
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

  const isSeries = item.kind === "series";
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
            {isSeries && onToggleExpand && (
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
              <div className="truncate text-sm font-medium">
                {item.title}
                {item.year && <span className="text-slate-500"> ({item.year})</span>}
              </div>
              <div className="mt-0.5 flex flex-wrap gap-1">
                <span className="chip bg-white/5 text-slate-400">{item.kind}</span>
                {item.my_episode_progress && (
                  <span className="chip bg-brand-500/15 text-brand-300">You: {item.my_episode_progress} eps</span>
                )}
                {item.group_episode_progress && item.kind === "series" && (
                  <span className="chip bg-white/5 text-slate-400">Group: {item.group_episode_progress} eps</span>
                )}
                {item.library_match && <InLibraryChip />}
                {item.everyone_watched && (
                  <span className="chip bg-emerald-500/15 text-emerald-300">everyone watched</span>
                )}
                {item.group_watch_progress && !item.everyone_watched && item.kind === "series" && (
                  <span className="chip bg-white/5 text-slate-400">{item.group_watch_progress} watched show</span>
                )}
              </div>
              <UserWatchBadges
                users={item.user_watch ?? []}
                currentUserId={currentUserId}
                onToggleSelf={toggleWatched}
              />
              {item.kind === "movie" && <ItemOverview item={item} />}
            </div>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            {item.kind !== "episode" && (
              <StarPicker value={item.my_rating} onChange={setRating} ratings={item.ratings ?? []} />
            )}
            <TitleMediaActions
              libraryMatch={item.library_match}
              onFindStreams={
                streamTarget && item.kind !== "episode"
                  ? () => onFindStreams(streamTarget)
                  : undefined
              }
              onPointerDown={stopDrag}
            />
            <ItemComments itemId={item.id} commentCount={item.comment_count} />
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
            <button type="button" onClick={() => onRequestDelete(item)} className="btn-ghost px-1 py-0.5 text-red-400">
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        </div>
      </div>
      {isSeries && expanded && (
        <SeriesExpandedPanel
          item={item}
          currentUserId={currentUserId}
          onUpdate={onUpdate}
          onParentRefresh={onRefresh}
          onRequestDelete={onRequestDelete}
          onFindStreams={onFindStreams}
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
  onGroupChange,
  onGoToQueue,
}: {
  user: UserInfo;
  refreshVersion?: number;
  initialGroupId?: number;
  onGroupChange?: (groupId: number) => void;
  onGoToQueue?: () => void;
}) {
  const { push: pushToast } = useToast();
  const { obs } = usePlayback();
  const [groups, setGroups] = useState<WatchlistGroup[]>([]);
  const [ungroupedCounts, setUngroupedCounts] = useState({ to_watch: 0, watched: 0 });
  const [selectedGroupId, setSelectedGroupId] = useState<number>(initialGroupId ?? 0);
  const [groupQueueBusy, setGroupQueueBusy] = useState(false);
  const [section, setSection] = useState<"to_watch" | "watched">("to_watch");
  const [items, setItems] = useState<WatchlistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [newGroupName, setNewGroupName] = useState("");
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [deleteTarget, setDeleteTarget] = useState<WatchlistItem | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [wheelOpen, setWheelOpen] = useState(false);
  const [streamTarget, setStreamTarget] = useState<StreamTarget | null>(null);
  const [error, setError] = useState("");

  const applyCounts = useCallback((groupId: number, counts: { to_watch: number; watched: number }) => {
    if (groupId === 0) {
      setUngroupedCounts(counts);
    } else {
      setGroups((prev) => prev.map((g) => (g.id === groupId ? { ...g, counts } : g)));
    }
  }, []);

  const loadGroups = useCallback(() => {
    api.watchlistGroups().then((r) => {
      setGroups(r.groups);
      setUngroupedCounts(r.ungrouped_counts);
    });
  }, []);

  const loadItems = useCallback(() => {
    setLoading(true);
    api
      .watchlistGroupItems(selectedGroupId, section)
      .then((r) => {
        setItems(r.items);
        if (r.counts) applyCounts(selectedGroupId, r.counts);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [selectedGroupId, section, applyCounts]);

  useEffect(() => {
    loadGroups();
  }, [loadGroups]);

  useEffect(() => {
    if (initialGroupId != null) setSelectedGroupId(initialGroupId);
  }, [initialGroupId]);

  const pickGroup = (id: number) => {
    setSelectedGroupId(id);
    onGroupChange?.(id);
  };

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  useEffect(() => {
    if (refreshVersion > 0) {
      loadGroups();
      loadItems();
    }
  }, [refreshVersion, loadGroups, loadItems]);

  const createGroup = async () => {
    if (!newGroupName.trim()) return;
    await api.watchlistCreateGroup(newGroupName.trim());
    setNewGroupName("");
    loadGroups();
  };

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIdx = items.findIndex((i) => i.id === active.id);
    const newIdx = items.findIndex((i) => i.id === over.id);
    const next = arrayMove(items, oldIdx, newIdx);
    setItems(next);
    api.watchlistReorder(next.map((it, idx) => ({ id: it.id, sort_order: idx, group_id: selectedGroupId || null })));
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
      .catch(() => {});
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
    selectedGroupId === 0 ? ungroupedCounts : selectedGroup?.counts ?? { to_watch: 0, watched: 0 };

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
              {ungroupedCounts.to_watch} · {ungroupedCounts.watched}
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
                {g.counts.to_watch} · {g.counts.watched}
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
        </div>

        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setSection("to_watch")}
              className={section === "to_watch" ? "btn-primary" : "btn-ghost"}
            >
              To Watch ({counts.to_watch})
            </button>
            <button
              type="button"
              onClick={() => setSection("watched")}
              className={section === "watched" ? "btn-primary" : "btn-ghost"}
            >
              Watched ({counts.watched})
            </button>
            {(selectedGroupId === 0 || selectedGroup?.wheel_enabled !== false) && section === "to_watch" && (
              <button type="button" onClick={spinWheel} className="btn-ghost ml-auto">
                <RotateCw className="h-4 w-4" /> Wheel spin
              </button>
            )}
          </div>

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
          ) : (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
              <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
                <div className="space-y-2">
                  {items.map((item) => (
                    <SortableRow
                      key={item.id}
                      item={item}
                      groups={groups}
                      currentUserId={user.id}
                      onUpdate={updateItem}
                      onRequestDelete={requestDelete}
                      onRemoveFromView={removeFromView}
                      onRefresh={refreshItems}
                      expanded={expanded.has(item.id)}
                      onFindStreams={setStreamTarget}
                      onToggleExpand={
                        item.kind === "series"
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
