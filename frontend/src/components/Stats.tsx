import {
  Loader2,
  MessageSquare,
  Sparkles,
  Star,
  ThumbsDown,
  Trophy,
  User,
  Users,
  X,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../api";
import type { StatsProfileTitle, StatsSummary, StatsTitle, StatsUserProfile, WatchlistComment } from "../types";

function formatStars(stars: number) {
  return stars.toFixed(stars % 1 === 0 ? 0 : 1);
}

function formatRelativeDate(iso: string) {
  const d = new Date(iso);
  const diffMs = Date.now() - d.getTime();
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 30) return `${Math.floor(days / 7)} wk ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

type ProfileSort = "needs_rating" | "highest_rated" | "lowest_rated" | "recent" | "oldest" | "title";

function profileSortLabel(sort: ProfileSort) {
  switch (sort) {
    case "needs_rating":
      return "Needs rating first";
    case "highest_rated":
      return "Highest rated";
    case "lowest_rated":
      return "Lowest rated";
    case "recent":
      return "Most recently watched";
    case "oldest":
      return "Oldest watched";
    case "title":
      return "Title A–Z";
  }
}

function sortProfileTitles(titles: StatsProfileTitle[], sort: ProfileSort) {
  const copy = [...titles];
  copy.sort((a, b) => {
    if (sort === "needs_rating") {
      const diff = Number(b.user_needs_rating) - Number(a.user_needs_rating);
      if (diff !== 0) return diff;
      return (b.user_watched_at ? Date.parse(b.user_watched_at) : 0) - (a.user_watched_at ? Date.parse(a.user_watched_at) : 0);
    }
    if (sort === "highest_rated") {
      return (b.user_rating ?? -1) - (a.user_rating ?? -1);
    }
    if (sort === "lowest_rated") {
      const ar = a.user_rating ?? 99;
      const br = b.user_rating ?? 99;
      return ar - br;
    }
    if (sort === "recent") {
      return (b.user_watched_at ? Date.parse(b.user_watched_at) : 0) - (a.user_watched_at ? Date.parse(a.user_watched_at) : 0);
    }
    if (sort === "oldest") {
      return (a.user_watched_at ? Date.parse(a.user_watched_at) : 0) - (b.user_watched_at ? Date.parse(b.user_watched_at) : 0);
    }
    return a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
  });
  return copy;
}

function KindBadge({ kind }: { kind: string }) {
  return <span className="chip bg-white/10 px-2 py-0 text-[10px] text-slate-300 capitalize">{kind}</span>;
}

function RatingChips({ ratings }: { ratings: StatsTitle["ratings"] }) {
  if (!ratings.length) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {ratings.map((r) => (
        <span key={r.user_id} className="chip bg-amber-500/10 px-2 py-0 text-[10px] text-amber-200">
          {r.username} {formatStars(r.stars)}★
        </span>
      ))}
    </div>
  );
}

function CompactTitleRow({
  item,
  rank,
  meta,
  actions,
  compact,
}: {
  item: StatsTitle;
  rank?: number;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  compact?: boolean;
}) {
  return (
    <div className="flex gap-2 rounded-lg border border-white/5 bg-white/[0.02] p-2">
      {rank != null && (
        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-white/5 text-[11px] font-bold text-slate-400">
          {rank}
        </div>
      )}
      {item.poster ? (
        <img src={item.poster} alt="" className="h-10 w-7 shrink-0 rounded object-cover bg-white/5" />
      ) : (
        <div className="flex h-10 w-7 shrink-0 items-center justify-center rounded bg-white/5 text-[10px] text-slate-500">?</div>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="truncate text-sm font-medium text-white">{item.title}</span>
          {item.year && <span className="text-[10px] text-slate-500">{item.year}</span>}
          <KindBadge kind={item.kind} />
        </div>
        {meta}
        {!compact && <RatingChips ratings={item.ratings} />}
        {actions && <div className="mt-1">{actions}</div>}
      </div>
    </div>
  );
}

function ProfileTitleRow({ item }: { item: StatsProfileTitle }) {
  return (
    <div className="flex gap-2 rounded-lg border border-white/5 bg-white/[0.02] p-2">
      {item.poster ? (
        <img src={item.poster} alt="" className="h-10 w-7 shrink-0 rounded object-cover bg-white/5" />
      ) : (
        <div className="flex h-10 w-7 shrink-0 items-center justify-center rounded bg-white/5 text-[10px] text-slate-500">?</div>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="truncate text-sm font-medium text-white">{item.title}</span>
          {item.year && <span className="text-[10px] text-slate-500">{item.year}</span>}
          <KindBadge kind={item.kind} />
          {item.user_needs_rating && (
            <span className="chip bg-amber-400/20 px-1.5 py-0 text-[10px] text-amber-200">Not rated</span>
          )}
        </div>
        <p className="mt-0.5 text-[11px] text-slate-400">
          {item.user_watched ? (
            <>
              Watched{item.user_watched_at ? ` · ${formatRelativeDate(item.user_watched_at)}` : ""}
            </>
          ) : (
            "Not finished"
          )}
          {item.user_rating != null && (
            <span className="ml-1 text-amber-300">· {formatStars(item.user_rating)}★</span>
          )}
          {item.user_commented && <span className="ml-1">· Commented</span>}
        </p>
      </div>
      {item.user_rating != null && (
        <div className="shrink-0 self-center text-sm font-semibold text-amber-300">{formatStars(item.user_rating)}★</div>
      )}
    </div>
  );
}

function CommentsModal({ item, onClose }: { item: StatsTitle; onClose: () => void }) {
  const [comments, setComments] = useState<WatchlistComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("");
  const [posting, setPosting] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    api
      .watchlistComments(item.id)
      .then((r) => setComments(r.comments))
      .finally(() => setLoading(false));
  }, [item.id]);

  useEffect(() => {
    load();
  }, [load]);

  const submit = async () => {
    if (!text.trim() || posting) return;
    setPosting(true);
    try {
      await api.watchlistAddComment(item.id, text.trim());
      setText("");
      load();
    } finally {
      setPosting(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="card flex max-h-[85vh] w-full max-w-lg flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-3 border-b border-white/10 p-4">
          {item.poster ? (
            <img src={item.poster} alt="" className="h-20 w-14 shrink-0 rounded-lg object-cover" />
          ) : (
            <div className="flex h-20 w-14 shrink-0 items-center justify-center rounded-lg bg-white/5 text-slate-500">?</div>
          )}
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold text-white">{item.title}</h3>
            {item.year && <p className="text-xs text-slate-500">{item.year}</p>}
          </div>
          <button type="button" onClick={onClose} className="btn-ghost shrink-0 p-2">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <Loader2 className="mx-auto h-5 w-5 animate-spin text-slate-400" />
          ) : comments.length === 0 ? (
            <p className="py-4 text-center text-sm text-slate-500">No comments yet.</p>
          ) : (
            <div className="space-y-3">
              {comments.map((c) => (
                <div key={c.id} className="rounded-lg bg-white/[0.03] p-2.5">
                  <div className="text-xs">
                    <span className="font-medium text-brand-300">{c.username}</span>
                    <span className="text-slate-500"> · {new Date(c.created_at).toLocaleDateString()}</span>
                  </div>
                  <p className="mt-0.5 text-sm text-slate-200">{c.body}</p>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="flex gap-2 border-t border-white/10 p-4">
          <input className="input flex-1 text-sm" value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a comment…" onKeyDown={(e) => e.key === "Enter" && submit()} />
          <button type="button" onClick={submit} disabled={posting || !text.trim()} className="btn-primary">
            Post
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

function StatCard({ label, value, sub, icon: Icon }: { label: string; value: string | number; sub?: string; icon: typeof Star }) {
  return (
    <div className="rounded-xl border border-white/5 bg-ink-850/70 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">{label}</p>
          <p className="mt-0.5 text-lg font-bold text-white">{value}</p>
          {sub && <p className="mt-0.5 truncate text-[10px] text-slate-400">{sub}</p>}
        </div>
        <div className="rounded-lg bg-brand-500/10 p-1.5">
          <Icon className="h-4 w-4 text-brand-400" />
        </div>
      </div>
    </div>
  );
}

function Section({ title, icon: Icon, empty, children }: { title: string; icon: typeof Star; empty?: string; children?: React.ReactNode }) {
  const hasContent = children != null && children !== false;
  return (
    <section className="rounded-xl border border-white/5 bg-ink-850/70 p-3">
      <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-white">
        <Icon className="h-3.5 w-3.5 text-brand-400" />
        {title}
      </h2>
      {hasContent ? children : <p className="text-xs text-slate-500">{empty ?? "Nothing here yet."}</p>}
    </section>
  );
}

function seriesEpNote(item: StatsTitle) {
  return item.kind === "series" && item.group_episode_progress ? ` · ${item.group_episode_progress} eps` : "";
}

function UserStatsFilter({
  users,
  selectedIds,
  onChange,
  disabled,
}: {
  users: { user_id: number; username: string }[];
  selectedIds: number[];
  onChange: (ids: number[]) => void;
  disabled?: boolean;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (!open || !buttonRef.current) return;
    const updatePosition = () => {
      const rect = buttonRef.current!.getBoundingClientRect();
      const panelWidth = 240;
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - panelWidth - 8));
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

  const allSelected = selectedIds.length === 0;
  const label = allSelected
    ? "All members"
    : selectedIds.length === 1
      ? users.find((u) => u.user_id === selectedIds[0])?.username ?? "1 member"
      : `${selectedIds.length} members`;

  const toggle = (userId: number) => {
    if (selectedIds.includes(userId)) onChange(selectedIds.filter((id) => id !== userId));
    else onChange([...selectedIds, userId].sort((a, b) => a - b));
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className="input mt-1 flex w-full items-center justify-between text-left text-sm sm:w-44 disabled:opacity-60"
      >
        <span className="truncate">{label}</span>
        <Users className="ml-2 h-4 w-4 shrink-0 text-slate-500" />
      </button>
      {open &&
        menuPos &&
        createPortal(
          <>
            <button type="button" className="fixed inset-0 z-[100]" aria-label="Close" onClick={() => setOpen(false)} />
            <div
              className="fixed z-[101] w-60 max-w-[calc(100vw-1rem)] rounded-lg border border-white/10 bg-ink-900 p-3 shadow-xl"
              style={{ top: menuPos.top, left: menuPos.left }}
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-slate-200">Include in stats</span>
                <button type="button" className="text-[10px] text-brand-300 hover:text-brand-200" onClick={() => onChange([])}>
                  All members
                </button>
              </div>
              <ul className="max-h-56 space-y-1 overflow-y-auto">
                {users.map((u) => {
                  const checked = allSelected || selectedIds.includes(u.user_id);
                  return (
                    <li key={u.user_id}>
                      <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-xs text-slate-300 hover:bg-white/5">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => {
                            if (allSelected) onChange(users.filter((x) => x.user_id !== u.user_id).map((x) => x.user_id));
                            else toggle(u.user_id);
                          }}
                        />
                        {u.username}
                      </label>
                    </li>
                  );
                })}
              </ul>
            </div>
          </>,
          document.body
        )}
    </>
  );
}

function StatsFilters({
  groupName,
  subtitle,
  groupId,
  groups,
  onGroupChange,
  memberOptions,
  selectedUserIds,
  onUsersChange,
  refreshing,
}: {
  groupName: string;
  subtitle: string;
  groupId: number | "all";
  groups: { id: number; name: string }[];
  onGroupChange: (id: number | "all") => void;
  memberOptions: { user_id: number; username: string }[];
  selectedUserIds: number[];
  onUsersChange: (ids: number[]) => void;
  refreshing: boolean;
}) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
      <div>
        <h1 className="text-xl font-bold text-white">Stats</h1>
        <p className="mt-0.5 text-xs text-slate-400">
          {groupName} · {subtitle}
        </p>
      </div>
      <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-end">
        <label className="w-full text-[10px] uppercase tracking-wide text-slate-500 sm:w-auto">
          Group
          <select
            className="input mt-1 w-full py-1.5 text-sm sm:w-40"
            value={groupId === "all" ? "all" : String(groupId)}
            onChange={(e) => {
              const v = e.target.value;
              onGroupChange(v === "all" ? "all" : Number(v));
            }}
          >
            <option value="all">All groups</option>
            <option value="0">Ungrouped</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </label>
        <label className="w-full text-[10px] uppercase tracking-wide text-slate-500 sm:w-auto">
          Members
          <UserStatsFilter users={memberOptions} selectedIds={selectedUserIds} onChange={onUsersChange} disabled={refreshing} />
        </label>
      </div>
    </div>
  );
}

function UserProfileView({ profile, groupName }: { profile: StatsUserProfile; groupName: string }) {
  const [sort, setSort] = useState<ProfileSort>("needs_rating");
  const sorted = useMemo(() => sortProfileTitles(profile.titles, sort), [profile.titles, sort]);

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-brand-500/20 bg-brand-500/5 p-3 sm:p-4">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-500/15 text-lg font-bold text-brand-300">
            {profile.username.slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold text-white">{profile.username}</h2>
            <p className="text-xs text-slate-400">{groupName}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <span className="chip bg-white/5 text-[10px] text-slate-300">{profile.watched_count} finished</span>
              <span className="chip bg-amber-500/10 text-[10px] text-amber-200">{profile.ratings_given} rated</span>
              {profile.avg_rating != null && (
                <span className="chip bg-amber-500/10 text-[10px] text-amber-200">{formatStars(profile.avg_rating)}★ avg</span>
              )}
              <span className="chip bg-white/5 text-[10px] text-slate-300">{profile.comments_given} commented</span>
              {profile.needs_rating_count > 0 && (
                <span className="chip bg-amber-400/15 text-[10px] text-amber-200">{profile.needs_rating_count} not rated yet</span>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-slate-400">{sorted.length} title{sorted.length === 1 ? "" : "s"} with activity</p>
        <label className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-slate-500">
          Sort
          <select className="input py-1 text-xs normal-case tracking-normal sm:w-44" value={sort} onChange={(e) => setSort(e.target.value as ProfileSort)}>
            {(Object.keys({ needs_rating: 1, highest_rated: 1, lowest_rated: 1, recent: 1, oldest: 1, title: 1 }) as ProfileSort[]).map((key) => (
              <option key={key} value={key}>
                {profileSortLabel(key)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="space-y-1.5">
        {sorted.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-500">No watch or rating activity in this group yet.</p>
        ) : (
          sorted.map((item) => <ProfileTitleRow key={item.id} item={item} />)
        )}
      </div>
    </div>
  );
}

function GroupStatsView({
  stats,
  memberFilterActive,
  memberScopeLabel,
  onComments,
}: {
  stats: StatsSummary;
  memberFilterActive: boolean;
  memberScopeLabel: string;
  onComments: (item: StatsTitle) => void;
}) {
  const { overview } = stats;

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard label="Watched" value={overview.watched_by_anyone} sub={`of ${overview.total_titles} titles`} icon={Users} />
        <StatCard
          label="All finished"
          value={overview.everyone_watched}
          sub={memberFilterActive ? `${memberScopeLabel} done` : "whole group done"}
          icon={Trophy}
        />
        <StatCard
          label="Avg rating"
          value={overview.avg_stars_all != null ? `${formatStars(overview.avg_stars_all)}★` : "—"}
          sub={`${overview.total_ratings} ratings`}
          icon={Star}
        />
        <StatCard label="Perfect 5★" value={stats.perfect_scores.length} sub="unanimous picks" icon={Sparkles} />
        <StatCard label="Members" value={overview.active_users} sub={memberFilterActive ? "in filter" : "active"} icon={Users} />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="space-y-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Ratings</p>
          <Section title="Favorites" icon={Star} empty="Not enough shared ratings yet.">
            {stats.top_rated.length > 0 && (
              <div className="space-y-1.5">
                {stats.top_rated.map((item, i) => (
                  <CompactTitleRow
                    key={item.id}
                    item={item}
                    rank={i + 1}
                    compact
                    meta={
                      <p className="mt-0.5 text-[11px] text-amber-300">
                        {formatStars(item.avg_stars!)}★ · {item.rating_count} rated · {item.watched_count}/{overview.active_users} watched
                        {seriesEpNote(item)}
                      </p>
                    }
                  />
                ))}
              </div>
            )}
          </Section>
          <Section title="Lowest rated" icon={ThumbsDown} empty="Not enough shared ratings yet.">
            {stats.worst_rated.length > 0 && (
              <div className="space-y-1.5">
                {stats.worst_rated.map((item, i) => (
                  <CompactTitleRow
                    key={item.id}
                    item={item}
                    rank={i + 1}
                    compact
                    meta={
                      <p className="mt-0.5 text-[11px] text-red-300">
                        {formatStars(item.avg_stars!)}★ · {item.rating_count} rated{seriesEpNote(item)}
                      </p>
                    }
                  />
                ))}
              </div>
            )}
          </Section>
          <Section title="Perfect scores" icon={Sparkles} empty="No unanimous 5★ titles yet.">
            {stats.perfect_scores.length > 0 && (
              <div className="space-y-1.5">
                {stats.perfect_scores.map((item, i) => (
                  <CompactTitleRow
                    key={item.id}
                    item={item}
                    rank={i + 1}
                    compact
                    meta={<p className="mt-0.5 text-[11px] text-amber-300">Unanimous 5★{seriesEpNote(item)}</p>}
                  />
                ))}
              </div>
            )}
          </Section>
        </div>

        <div className="space-y-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Activity</p>
          <Section title="Recently watched" icon={Star} empty="Nothing marked watched yet.">
            {stats.recently_watched.length > 0 && (
              <div className="space-y-1.5">
                {stats.recently_watched.map((item) => (
                  <CompactTitleRow
                    key={item.id}
                    item={item}
                    compact
                    meta={
                      <p className="mt-0.5 text-[11px] text-slate-400">
                        {item.latest_watched_at && formatRelativeDate(item.latest_watched_at)} · {item.watched_count}/{overview.active_users} watched
                        {item.avg_stars != null && ` · ${formatStars(item.avg_stars)}★`}
                        {seriesEpNote(item)}
                      </p>
                    }
                  />
                ))}
              </div>
            )}
          </Section>
          <Section title="Everyone finished" icon={Users} empty={memberFilterActive ? "Nothing finished by all selected." : "Nothing finished by everyone."}>
            {stats.everyone_watched.length > 0 && (
              <div className="space-y-1.5">
                {stats.everyone_watched.map((item) => (
                  <CompactTitleRow
                    key={item.id}
                    item={item}
                    compact
                    meta={
                      <p className="mt-0.5 text-[11px] text-slate-400">
                        {item.latest_watched_at ? formatRelativeDate(item.latest_watched_at) : "Done"}
                        {item.avg_stars != null && ` · ${formatStars(item.avg_stars)}★`}
                        {seriesEpNote(item)}
                      </p>
                    }
                  />
                ))}
              </div>
            )}
          </Section>
          <Section title="Hot takes" icon={Zap} empty="Need more disagreement.">
            {stats.most_divisive.length > 0 && (
              <div className="space-y-1.5">
                {stats.most_divisive.map((item, i) => (
                  <CompactTitleRow
                    key={item.id}
                    item={item}
                    rank={i + 1}
                    compact
                    meta={
                      <p className="mt-0.5 text-[11px] text-orange-300">
                        ±{formatStars(item.rating_stddev!)} spread · {formatStars(item.avg_stars!)}★ avg{seriesEpNote(item)}
                      </p>
                    }
                  />
                ))}
              </div>
            )}
          </Section>
          <Section title="Most debated" icon={MessageSquare} empty="No comments yet.">
            {stats.most_commented.length > 0 && (
              <div className="space-y-1.5">
                {stats.most_commented.map((item, i) => (
                  <CompactTitleRow
                    key={item.id}
                    item={item}
                    rank={i + 1}
                    compact
                    meta={
                      <p className="mt-0.5 text-[11px] text-slate-400">
                        {item.comment_count} comment{item.comment_count !== 1 ? "s" : ""}
                        {item.avg_stars != null && ` · ${formatStars(item.avg_stars)}★`}
                        {seriesEpNote(item)}
                      </p>
                    }
                    actions={
                      <button type="button" onClick={() => onComments(item)} className="btn-ghost px-1.5 py-0.5 text-[10px]">
                        <MessageSquare className="h-3 w-3" /> Comments
                      </button>
                    }
                  />
                ))}
              </div>
            )}
          </Section>
        </div>
      </div>

      {!memberFilterActive && (
        <Section title="Leaderboard" icon={Trophy}>
          {stats.user_leaderboard.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-white/10 text-left uppercase tracking-wide text-slate-500">
                    <th className="pb-1.5 pr-3 font-medium">Member</th>
                    <th className="pb-1.5 pr-3 font-medium">Finished</th>
                    <th className="pb-1.5 pr-3 font-medium">Ratings</th>
                    <th className="pb-1.5 font-medium">Avg</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.user_leaderboard.map((row, i) => (
                    <tr key={row.user_id} className="border-b border-white/5 last:border-0">
                      <td className="py-2 pr-3">
                        <span className="mr-1.5 text-slate-500">{i + 1}.</span>
                        <span className="font-medium text-white">{row.username}</span>
                      </td>
                      <td className="py-2 pr-3 text-slate-300">{row.watched_count}</td>
                      <td className="py-2 pr-3 text-slate-300">{row.ratings_given}</td>
                      <td className="py-2 text-amber-300">{row.avg_rating_given != null ? `${formatStars(row.avg_rating_given)}★` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-xs text-slate-500">No members yet.</p>
          )}
        </Section>
      )}

      {memberFilterActive && stats.user_leaderboard.length > 1 && (
        <Section title="Selected members" icon={User}>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-white/10 text-left uppercase tracking-wide text-slate-500">
                  <th className="pb-1.5 pr-3 font-medium">Member</th>
                  <th className="pb-1.5 pr-3 font-medium">Finished</th>
                  <th className="pb-1.5 pr-3 font-medium">Ratings</th>
                  <th className="pb-1.5 font-medium">Avg</th>
                </tr>
              </thead>
              <tbody>
                {stats.user_leaderboard.map((row, i) => (
                  <tr key={row.user_id} className="border-b border-white/5 last:border-0">
                    <td className="py-2 pr-3">
                      <span className="mr-1.5 text-slate-500">{i + 1}.</span>
                      <span className="font-medium text-white">{row.username}</span>
                    </td>
                    <td className="py-2 pr-3 text-slate-300">{row.watched_count}</td>
                    <td className="py-2 pr-3 text-slate-300">{row.ratings_given}</td>
                    <td className="py-2 text-amber-300">{row.avg_rating_given != null ? `${formatStars(row.avg_rating_given)}★` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}
    </div>
  );
}

export function Stats() {
  const [stats, setStats] = useState<StatsSummary | null>(null);
  const [memberOptions, setMemberOptions] = useState<{ user_id: number; username: string }[]>([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [commentsItem, setCommentsItem] = useState<StatsTitle | null>(null);
  const [groupId, setGroupId] = useState<number | "all">("all");
  const [groups, setGroups] = useState<{ id: number; name: string }[]>([]);
  const [selectedUserIds, setSelectedUserIds] = useState<number[]>([]);
  const requestRef = useRef(0);

  const loadStats = useCallback((gid: number | "all", userIds: number[]) => {
    const requestId = ++requestRef.current;
    setRefreshing(true);
    setError("");
    api
      .getStats(gid === "all" ? undefined : gid, userIds.length ? userIds : undefined)
      .then((data) => {
        if (requestId !== requestRef.current) return;
        setStats(data);
        setMemberOptions(data.users);
      })
      .catch((e: Error) => {
        if (requestId !== requestRef.current) return;
        setError(e.message);
      })
      .finally(() => {
        if (requestId !== requestRef.current) return;
        setRefreshing(false);
        setInitialLoading(false);
      });
  }, []);

  useEffect(() => {
    api.watchlistGroups().then((r) => setGroups(r.groups.map((g) => ({ id: g.id, name: g.name }))));
  }, []);

  useEffect(() => {
    loadStats(groupId, selectedUserIds);
  }, [groupId, selectedUserIds, loadStats]);

  if (initialLoading && !stats) {
    return (
      <div className="flex items-center justify-center py-24 text-slate-400">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        Loading stats…
      </div>
    );
  }

  if (error && !stats) {
    return <div className="card p-8 text-center text-red-300">Failed to load stats: {error}</div>;
  }

  if (!stats) return null;

  const memberFilterActive = selectedUserIds.length > 0;
  const singleUserProfile = selectedUserIds.length === 1 && stats.profile;
  const memberScopeLabel = `${stats.overview.active_users} member${stats.overview.active_users === 1 ? "" : "s"}`;
  const subtitle = singleUserProfile
    ? `${stats.profile!.username}'s profile`
    : memberFilterActive
      ? `${memberScopeLabel} selected`
      : "group overview";

  return (
    <div className="relative space-y-3">
      {refreshing && (
        <div className="pointer-events-none absolute right-0 top-0 z-10 flex items-center gap-1.5 rounded-full bg-ink-900/90 px-2.5 py-1 text-[11px] text-slate-300 shadow-lg ring-1 ring-white/10">
          <Loader2 className="h-3 w-3 animate-spin" />
          Updating…
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">Failed to refresh stats: {error}</div>
      )}

      <div className={`space-y-3 transition-opacity ${refreshing ? "opacity-80" : "opacity-100"}`}>
        <StatsFilters
          groupName={stats.group_name}
          subtitle={subtitle}
          groupId={groupId}
          groups={groups}
          onGroupChange={setGroupId}
          memberOptions={memberOptions}
          selectedUserIds={selectedUserIds}
          onUsersChange={setSelectedUserIds}
          refreshing={refreshing}
        />

        {singleUserProfile ? (
          <UserProfileView profile={stats.profile!} groupName={stats.group_name} />
        ) : (
          <GroupStatsView
            stats={stats}
            memberFilterActive={memberFilterActive}
            memberScopeLabel={memberScopeLabel}
            onComments={setCommentsItem}
          />
        )}
      </div>

      {commentsItem && <CommentsModal item={commentsItem} onClose={() => setCommentsItem(null)} />}
    </div>
  );
}
