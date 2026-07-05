import { Clapperboard, Dices, Download, ListChecks, Play, Radio, Star, X } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../api";
import { canLocalDownload } from "../localDownload";
import type { MovieNightSession, PlayerState, UserInfo, WatchlistGroup, WatchlistItem } from "../types";
import { InLibraryChip } from "./InLibraryChip";
import { streamTargetFromWatchlistItem, type StreamTarget } from "./streamTarget";
import { TitleStreamsModal } from "./TitleStreamsModal";
import { useToast } from "./Toast";
import { WheelSpinModal } from "./WheelSpinModal";

interface Props {
  session: MovieNightSession | null;
  onSessionChange: (session: MovieNightSession | null) => void;
  player: PlayerState | null;
  user: UserInfo;
  /** Bumped on library/watchlist changes (see QueuePlayer) — triggers a
   * session refetch so a pick's `needs_download` flips once its download
   * auto-links. */
  libraryVersion?: number;
}

function StarButtons({ value, onChange }: { value: number | null; onChange: (stars: number) => void }) {
  const rating = value ?? 0;
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          onClick={() => onChange(rating === star ? 0 : star)}
          title={`${star} star${star === 1 ? "" : "s"}`}
          className="rounded p-0.5"
        >
          <Star
            className={`h-5 w-5 ${
              rating >= star ? "fill-amber-400 text-amber-400" : "text-slate-600"
            }`}
          />
        </button>
      ))}
    </div>
  );
}

export function SessionPanel({ session, onSessionChange, player, user, libraryVersion }: Props) {
  const { push: pushToast } = useToast();
  const [groups, setGroups] = useState<WatchlistGroup[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);
  const [starting, setStarting] = useState(false);
  const [ending, setEnding] = useState(false);

  const [wheelOpen, setWheelOpen] = useState(false);
  const [poolItems, setPoolItems] = useState<WatchlistItem[]>([]);
  const [poolLoading, setPoolLoading] = useState(false);
  const [picking, setPicking] = useState(false);
  const [queuing, setQueuing] = useState(false);
  const [streamTarget, setStreamTarget] = useState<StreamTarget | null>(null);

  const [ratingItem, setRatingItem] = useState<WatchlistItem | null>(null);
  const [ratingLoading, setRatingLoading] = useState(false);

  const isHost = !!session && session.started_by_user_id === user.id;

  useEffect(() => {
    if (session) return;
    api
      .watchlistGroups()
      .then((r) => setGroups(r.groups))
      .catch(() => setGroups([]));
  }, [session]);

  // Manual-pick fallback: load the group's items while picking. In-library
  // titles sort first, but everything is pickable — titles that still need a
  // download surface the "Grab a stream" flow once picked.
  useEffect(() => {
    if (!session || session.state !== "picking") return;
    setPoolLoading(true);
    api
      .watchlistGroupItems(session.group_id ?? 0)
      .then((r) => {
        const sorted = [...r.items].sort((a, b) => {
          const aIn = a.library_item_id != null ? 0 : 1;
          const bIn = b.library_item_id != null ? 0 : 1;
          return aIn - bIn;
        });
        setPoolItems(sorted);
      })
      .catch(() => setPoolItems([]))
      .finally(() => setPoolLoading(false));
  }, [session?.id, session?.state, session?.group_id]);

  // Refresh on library/watchlist change: a pick's download may have just
  // auto-linked (library_update -> bumped libraryVersion). The backend's
  // GET /current lazy-syncs the link, so refetching flips needs_download off
  // and unblocks "Queue it" without the user having to do anything.
  useEffect(() => {
    if (!session || !session.needs_download) return;
    api
      .sessionCurrent()
      .then((r) => onSessionChange(r.active))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [libraryVersion]);

  // Host-only auto-advance: queued -> playing when the session's library item
  // becomes the current player item; playing -> rating when it ends. Gated on
  // the session starter's user id so only one client fires each transition;
  // the backend transition itself is idempotent (400 if already advanced),
  // but gating avoids a burst of failed requests from every open client.
  useEffect(() => {
    if (!session || !isHost || !player) return;
    const currentPath = player.current?.library_path;
    const sessionPath = session.library_path;
    if (!sessionPath || !currentPath || currentPath !== sessionPath) return;

    if (session.state === "queued" && player.media_state === "OBS_MEDIA_STATE_PLAYING") {
      api
        .sessionAdvance("playing")
        .then(onSessionChange)
        .catch(() => {});
      return;
    }

    if (session.state === "playing" && player.media_state === "OBS_MEDIA_STATE_ENDED") {
      api
        .sessionAdvance("rating")
        .then(onSessionChange)
        .catch(() => {});
    }
  }, [session, isHost, player, onSessionChange]);

  // Rating step: load the full watchlist item (ratings/user_watch arrays).
  useEffect(() => {
    if (!session || session.state !== "rating" || !session.watchlist_item_id) {
      setRatingItem(null);
      return;
    }
    setRatingLoading(true);
    api
      .watchlistGroupItems(session.group_id ?? 0)
      .then((r) => {
        const found = r.items.find((i) => i.id === session.watchlist_item_id) ?? null;
        setRatingItem(found);
      })
      .catch(() => setRatingItem(null))
      .finally(() => setRatingLoading(false));
  }, [session?.id, session?.state, session?.watchlist_item_id, session?.group_id]);

  const startSession = async () => {
    setStarting(true);
    try {
      const s = await api.sessionStart(selectedGroupId ?? undefined);
      onSessionChange(s);
    } catch (err: unknown) {
      pushToast(err instanceof Error ? err.message : "Could not start session", "error");
    } finally {
      setStarting(false);
    }
  };

  const endSession = async () => {
    setEnding(true);
    try {
      const s = await api.sessionEnd();
      onSessionChange(s.state === "ended" ? null : s);
      pushToast("Movie night session ended", "info");
    } catch (err: unknown) {
      pushToast(err instanceof Error ? err.message : "Could not end session", "error");
    } finally {
      setEnding(false);
    }
  };

  const pickItem = async (itemId: number) => {
    setPicking(true);
    try {
      const s = await api.sessionPick(itemId);
      onSessionChange(s);
    } catch (err: unknown) {
      pushToast(err instanceof Error ? err.message : "Could not pick this title", "error");
    } finally {
      setPicking(false);
    }
  };

  const queuePick = async () => {
    setQueuing(true);
    try {
      const s = await api.sessionQueue();
      onSessionChange(s);
      pushToast("Added to the queue", "success");
    } catch (err: unknown) {
      pushToast(err instanceof Error ? err.message : "Could not queue this title", "error");
    } finally {
      setQueuing(false);
    }
  };

  const advance = async (state: "playing" | "rating") => {
    try {
      const s = await api.sessionAdvance(state);
      onSessionChange(s);
    } catch (err: unknown) {
      pushToast(err instanceof Error ? err.message : "Could not advance session", "error");
    }
  };

  const toggleWatched = async () => {
    if (!ratingItem) return;
    try {
      const next = await api.watchlistSetWatched(ratingItem.id, !ratingItem.my_watched);
      setRatingItem(next);
    } catch (err: unknown) {
      pushToast(err instanceof Error ? err.message : "Could not update watched status", "error");
    }
  };

  const setRating = async (stars: number) => {
    if (!ratingItem) return;
    try {
      const next = await api.watchlistSetRating(ratingItem.id, stars);
      setRatingItem(next);
    } catch (err: unknown) {
      pushToast(err instanceof Error ? err.message : "Could not save rating", "error");
    }
  };

  if (!session) {
    return (
      <section className="card space-y-3 p-5">
        <div className="flex items-center gap-2">
          <Clapperboard className="h-5 w-5 text-brand-400" />
          <h2 className="text-lg font-semibold">Start movie night</h2>
        </div>
        <p className="text-sm text-slate-400">
          Guided flow: pick a title, spin the wheel, queue it, go live, then rate it together.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={selectedGroupId ?? ""}
            onChange={(e) => setSelectedGroupId(e.target.value ? Number(e.target.value) : null)}
            className="input max-w-xs text-sm"
          >
            <option value="">Ungrouped watchlist</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
          <button type="button" disabled={starting} onClick={startSession} className="btn-primary">
            {starting ? "Starting…" : "Start session"}
          </button>
        </div>
      </section>
    );
  }

  const groupName = groups.find((g) => g.id === session.group_id)?.name || "Watchlist";

  return (
    <section className="card space-y-4 p-5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Clapperboard className="h-5 w-5 text-brand-400" />
          <div>
            <h2 className="text-lg font-semibold">Movie night in progress</h2>
            <p className="text-xs text-slate-500">
              {session.group_id != null ? groupName : "Ungrouped watchlist"} · step: {session.state}
            </p>
          </div>
        </div>
        <button type="button" disabled={ending} onClick={endSession} className="btn-ghost text-xs text-red-300">
          <X className="h-3.5 w-3.5" /> End session
        </button>
      </div>

      {session.state === "picking" && !session.watchlist_item_id && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setWheelOpen(true)} className="btn-primary">
              <Dices className="h-4 w-4" /> Spin the wheel
            </button>
          </div>
          <div>
            <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Or pick manually
            </div>
            {poolLoading ? (
              <p className="text-sm text-slate-500">Loading…</p>
            ) : poolItems.length === 0 ? (
              <p className="text-sm text-slate-500">No titles in this group yet.</p>
            ) : (
              <div className="max-h-48 space-y-1 overflow-y-auto rounded-xl border border-white/5 p-2">
                {poolItems.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    disabled={picking}
                    onClick={() => pickItem(item.id)}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-white/5 disabled:opacity-50"
                  >
                    <span className="min-w-0 flex-1 truncate">{item.title}</span>
                    {item.library_item_id != null ? (
                      <InLibraryChip />
                    ) : (
                      <span className="chip bg-amber-500/15 text-[10px] text-amber-300">Needs download</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {session.state === "picking" && session.watchlist_item_id && (
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            {session.watchlist_item_poster && (
              <img
                src={session.watchlist_item_poster}
                alt=""
                className="h-16 w-11 shrink-0 rounded object-cover"
              />
            )}
            <div className="min-w-0 flex-1">
              <div className="text-xs text-slate-500">Tonight&apos;s pick</div>
              <div className="truncate font-medium">{session.watchlist_item_title}</div>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1.5">
              {session.needs_download && (
                <button
                  type="button"
                  onClick={() => {
                    const item = poolItems.find((i) => i.id === session.watchlist_item_id);
                    const target = item ? streamTargetFromWatchlistItem(item) : null;
                    if (target) setStreamTarget(target);
                    else pushToast("Could not find stream details for this pick", "error");
                  }}
                  className="btn-primary"
                >
                  <Download className="h-4 w-4" /> Grab a stream
                </button>
              )}
              <button
                type="button"
                disabled={queuing || session.needs_download}
                title={session.needs_download ? "Waiting for download…" : undefined}
                onClick={queuePick}
                className={session.needs_download ? "btn-ghost text-xs disabled:opacity-50" : "btn-primary"}
              >
                <ListChecks className="h-4 w-4" /> {queuing ? "Queuing…" : "Queue it"}
              </button>
            </div>
          </div>
          {session.needs_download && (
            <p className="text-xs text-amber-300">
              This title isn&apos;t downloaded yet — grab a stream, then queue it once it lands in your library.
            </p>
          )}
        </div>
      )}

      <TitleStreamsModal
        open={!!streamTarget}
        target={streamTarget}
        onClose={() => setStreamTarget(null)}
        allowLocalDownload={canLocalDownload(user)}
      />

      {session.state === "queued" && (
        <div className="space-y-2">
          <p className="text-sm text-slate-300">
            <span className="font-medium">{session.watchlist_item_title || session.library_item_title}</span>{" "}
            is in the queue. Play it and go live when everyone&apos;s ready.
          </p>
          {isHost && (
            <button type="button" onClick={() => advance("playing")} className="btn-ghost text-xs">
              <Play className="h-3.5 w-3.5" /> Mark as playing
            </button>
          )}
        </div>
      )}

      {session.state === "playing" && (
        <div className="space-y-2">
          <p className="flex items-center gap-2 text-sm text-slate-300">
            <Radio className="h-4 w-4 text-brand-400" />
            Now playing: <span className="font-medium">{session.watchlist_item_title || session.library_item_title}</span>
          </p>
          {isHost && (
            <button type="button" onClick={() => advance("rating")} className="btn-ghost text-xs">
              Move to rating
            </button>
          )}
        </div>
      )}

      {session.state === "rating" && (
        <div className="space-y-3">
          <p className="text-sm text-slate-300">
            How was <span className="font-medium">{session.watchlist_item_title}</span>?
          </p>
          {ratingLoading ? (
            <p className="text-sm text-slate-500">Loading…</p>
          ) : ratingItem ? (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={toggleWatched}
                  className={`chip ${
                    ratingItem.my_watched ? "bg-emerald-500/20 text-emerald-300" : "bg-white/5 text-slate-400"
                  }`}
                >
                  {ratingItem.my_watched ? "Watched ✓" : "Mark watched"}
                </button>
                <StarButtons value={ratingItem.my_rating} onChange={setRating} />
              </div>
              <div className="text-xs text-slate-500">
                Waiting on:{" "}
                {(ratingItem.user_watch ?? []).filter((u) => !u.watched).length === 0
                  ? "everyone's watched!"
                  : (ratingItem.user_watch ?? [])
                      .filter((u) => !u.watched)
                      .map((u) => u.username)
                      .join(", ")}
              </div>
            </>
          ) : (
            <p className="text-sm text-slate-500">Could not load rating details.</p>
          )}
        </div>
      )}

      <WheelSpinModal
        open={wheelOpen}
        groupId={session.group_id ?? 0}
        groupName={groupName}
        onClose={() => setWheelOpen(false)}
        onWinner={(itemId) => pickItem(itemId)}
      />
    </section>
  );
}
