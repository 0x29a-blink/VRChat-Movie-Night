import {
  Loader2,
  MessageSquare,
  Sparkles,
  Star,
  ThumbsDown,
  Trophy,
  Users,
  X,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../api";
import type { StatsSummary, StatsTitle, WatchlistComment } from "../types";

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

function KindBadge({ kind }: { kind: string }) {
  return (
    <span className="chip bg-white/10 text-slate-300 capitalize">{kind}</span>
  );
}

function RatingChips({ ratings }: { ratings: StatsTitle["ratings"] }) {
  if (!ratings.length) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {ratings.map((r) => (
        <span
          key={r.user_id}
          className="chip bg-amber-500/10 text-amber-200"
          title={`${r.username}: ${formatStars(r.stars)}★`}
        >
          {r.username} {formatStars(r.stars)}★
        </span>
      ))}
    </div>
  );
}

function TitleRow({
  item,
  rank,
  meta,
  actions,
}: {
  item: StatsTitle;
  rank?: number;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex gap-2 sm:gap-3 rounded-xl border border-white/5 bg-white/[0.02] p-2.5 sm:p-3">
      {rank != null && (
        <div className="flex h-7 w-7 sm:h-8 sm:w-8 shrink-0 items-center justify-center rounded-lg bg-white/5 text-xs sm:text-sm font-bold text-slate-400">
          {rank}
        </div>
      )}
      {item.poster ? (
        <img
          src={item.poster}
          alt=""
          className="h-12 w-8 sm:h-16 sm:w-11 shrink-0 rounded-lg object-cover bg-white/5"
        />
      ) : (
        <div className="flex h-12 w-8 sm:h-16 sm:w-11 shrink-0 items-center justify-center rounded-lg bg-white/5 text-xs text-slate-500">
          ?
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate font-medium text-white">{item.title}</span>
          {item.year && <span className="text-xs text-slate-500">{item.year}</span>}
          <KindBadge kind={item.kind} />
        </div>
        {meta}
        <RatingChips ratings={item.ratings} />
        {actions && <div className="mt-2">{actions}</div>}
      </div>
    </div>
  );
}

function CommentsModal({
  item,
  onClose,
}: {
  item: StatsTitle;
  onClose: () => void;
}) {
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
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="card flex max-h-[85vh] w-full max-w-lg flex-col"
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 border-b border-white/10 p-4">
          {item.poster ? (
            <img src={item.poster} alt="" className="h-20 w-14 shrink-0 rounded-lg object-cover" />
          ) : (
            <div className="flex h-20 w-14 shrink-0 items-center justify-center rounded-lg bg-white/5 text-slate-500">
              ?
            </div>
          )}
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold text-white">{item.title}</h3>
            {item.year && <p className="text-xs text-slate-500">{item.year}</p>}
            <p className="mt-1 text-xs text-slate-400">
              {item.comment_count} comment{item.comment_count !== 1 ? "s" : ""}
            </p>
          </div>
          <button type="button" onClick={onClose} className="btn-ghost shrink-0 p-2">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex justify-center py-8 text-slate-400">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : comments.length === 0 ? (
            <p className="py-4 text-center text-sm text-slate-500">No comments yet.</p>
          ) : (
            <div className="space-y-4">
              {comments.map((c) => (
                <div key={c.id} className="rounded-lg bg-white/[0.03] p-3">
                  <div className="text-xs">
                    <span className="font-medium text-brand-300">{c.username}</span>
                    <span className="text-slate-500">
                      {" "}
                      · {new Date(c.created_at).toLocaleString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-slate-200">{c.body}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex gap-2 border-t border-white/10 p-4">
          <input
            className="input flex-1 text-sm"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Add a comment…"
            onKeyDown={(e) => e.key === "Enter" && submit()}
          />
          <button type="button" onClick={submit} disabled={posting || !text.trim()} className="btn-primary">
            Post
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

function StatCard({
  label,
  value,
  sub,
  icon: Icon,
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon: typeof Star;
}) {
  return (
    <div className="card p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
          <p className="mt-1 text-2xl font-bold text-white">{value}</p>
          {sub && <p className="mt-0.5 text-xs text-slate-400">{sub}</p>}
        </div>
        <div className="rounded-xl bg-brand-500/10 p-2">
          <Icon className="h-5 w-5 text-brand-400" />
        </div>
      </div>
    </div>
  );
}

function Section({
  title,
  icon: Icon,
  empty,
  children,
}: {
  title: string;
  icon: typeof Star;
  empty?: string;
  children?: React.ReactNode;
}) {
  const hasContent = children != null && children !== false;
  return (
    <section className="card p-5">
      <h2 className="mb-4 flex items-center gap-2 text-base font-semibold text-white">
        <Icon className="h-4 w-4 text-brand-400" />
        {title}
      </h2>
      {hasContent ? (
        children
      ) : (
        <p className="text-sm text-slate-500">{empty ?? "Nothing here yet."}</p>
      )}
    </section>
  );
}

function seriesEpNote(item: StatsTitle) {
  return item.kind === "series" && item.group_episode_progress
    ? ` · ${item.group_episode_progress} eps watched`
    : "";
}

export function Stats() {
  const [stats, setStats] = useState<StatsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [commentsItem, setCommentsItem] = useState<StatsTitle | null>(null);
  const [groupId, setGroupId] = useState<number | "all">("all");
  const [groups, setGroups] = useState<{ id: number; name: string }[]>([]);

  const loadStats = useCallback((gid: number | "all") => {
    setLoading(true);
    setError("");
    api
      .getStats(gid === "all" ? undefined : gid)
      .then(setStats)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    api.watchlistGroups().then((r) => setGroups(r.groups.map((g) => ({ id: g.id, name: g.name }))));
  }, []);

  useEffect(() => {
    loadStats(groupId);
  }, [groupId, loadStats]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-slate-400">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        Loading stats…
      </div>
    );
  }

  if (error) {
    return (
      <div className="card p-8 text-center text-red-300">
        Failed to load stats: {error}
      </div>
    );
  }

  if (!stats) return null;

  const { overview } = stats;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-white">Stats</h1>
          <p className="mt-1 text-sm text-slate-400">
            {stats.group_name} — watch history, ratings, and leaderboard
          </p>
        </div>
        <label className="w-full text-xs text-slate-400 sm:w-auto">
          Group
          <select
            className="input mt-1 w-full text-sm sm:w-48"
            value={groupId === "all" ? "all" : String(groupId)}
            onChange={(e) => {
              const v = e.target.value;
              setGroupId(v === "all" ? "all" : Number(v));
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
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard
          label="Watched together"
          value={overview.watched_by_anyone}
          sub={`of ${overview.total_titles} on watchlist`}
          icon={Users}
        />
        <StatCard
          label="Everyone finished"
          value={overview.everyone_watched}
          sub="whole group checked off"
          icon={Trophy}
        />
        <StatCard
          label="Group avg rating"
          value={overview.avg_stars_all != null ? `${formatStars(overview.avg_stars_all)}★` : "—"}
          sub={`${overview.total_ratings} ratings total`}
          icon={Star}
        />
        <StatCard
          label="Perfect picks"
          value={stats.perfect_scores.length}
          sub="unanimous 5★ titles"
          icon={Sparkles}
        />
        <StatCard
          label="Active members"
          value={overview.active_users}
          icon={Users}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Group favorites" icon={Star} empty="Rate a few titles together to see favorites.">
          {stats.top_rated.length > 0 && (
            <div className="space-y-2">
              {stats.top_rated.map((item, i) => (
                <TitleRow
                  key={item.id}
                  item={item}
                  rank={i + 1}
                  meta={
                    <p className="mt-0.5 text-sm text-amber-300">
                      {formatStars(item.avg_stars!)}★ avg · {item.rating_count} rated ·{" "}
                      {item.watched_count}/{overview.active_users} watched{seriesEpNote(item)}
                    </p>
                  }
                />
              ))}
            </div>
          )}
        </Section>

        <Section title="Perfect scores" icon={Sparkles} empty="When everyone rates 5★, it shows up here.">
          {stats.perfect_scores.length > 0 && (
            <div className="space-y-2">
              {stats.perfect_scores.map((item, i) => (
                <TitleRow
                  key={item.id}
                  item={item}
                  rank={i + 1}
                  meta={
                    <p className="mt-0.5 text-sm text-amber-300">
                      Unanimous 5★ · {item.rating_count} rated{seriesEpNote(item)}
                    </p>
                  }
                />
              ))}
            </div>
          )}
        </Section>

        <Section title="Worst rated" icon={ThumbsDown} empty="Rate a few titles together to see the bottom of the list.">
          {stats.worst_rated.length > 0 && (
            <div className="space-y-2">
              {stats.worst_rated.map((item, i) => (
                <TitleRow
                  key={item.id}
                  item={item}
                  rank={i + 1}
                  meta={
                    <p className="mt-0.5 text-sm text-red-300">
                      {formatStars(item.avg_stars!)}★ avg · {item.rating_count} rated ·{" "}
                      {item.watched_count}/{overview.active_users} watched{seriesEpNote(item)}
                    </p>
                  }
                />
              ))}
            </div>
          )}
        </Section>

        <Section title="We all finished" icon={Users} empty="Mark a title watched for every member.">
          {stats.everyone_watched.length > 0 && (
            <div className="space-y-2">
              {stats.everyone_watched.map((item) => (
                <TitleRow
                  key={item.id}
                  item={item}
                  meta={
                    <p className="mt-0.5 text-sm text-slate-400">
                      {item.avg_stars != null
                        ? `${formatStars(item.avg_stars)}★ avg · `
                        : "No ratings yet · "}
                      {item.latest_watched_at
                        ? `last finished ${formatRelativeDate(item.latest_watched_at)}`
                        : ""}
                      {seriesEpNote(item)}
                    </p>
                  }
                />
              ))}
            </div>
          )}
        </Section>

        <Section title="Hot takes" icon={Zap} empty="Need at least 3 ratings with disagreement.">
          {stats.most_divisive.length > 0 && (
            <div className="space-y-2">
              {stats.most_divisive.map((item, i) => (
                <TitleRow
                  key={item.id}
                  item={item}
                  rank={i + 1}
                  meta={
                    <p className="mt-0.5 text-sm text-orange-300">
                      {formatStars(item.avg_stars!)}★ avg · spread ±{formatStars(item.rating_stddev!)}
                      {seriesEpNote(item)}
                    </p>
                  }
                />
              ))}
            </div>
          )}
        </Section>

        <Section title="Recently watched" icon={Star} empty="Nothing marked watched yet.">
          {stats.recently_watched.length > 0 && (
            <div className="space-y-2">
              {stats.recently_watched.map((item) => (
                <TitleRow
                  key={item.id}
                  item={item}
                  meta={
                    <p className="mt-0.5 text-sm text-slate-400">
                      {item.latest_watched_at && formatRelativeDate(item.latest_watched_at)} ·{" "}
                      {item.watched_count}/{overview.active_users} watched{seriesEpNote(item)}
                      {item.avg_stars != null && ` · ${formatStars(item.avg_stars)}★`}
                    </p>
                  }
                />
              ))}
            </div>
          )}
        </Section>

        <Section title="Most debated" icon={MessageSquare} empty="No comments on watched titles yet.">
          {stats.most_commented.length > 0 && (
            <div className="space-y-2">
              {stats.most_commented.map((item, i) => (
                <TitleRow
                  key={item.id}
                  item={item}
                  rank={i + 1}
                  meta={
                    <p className="mt-0.5 text-sm text-slate-400">
                      {item.comment_count} comment{item.comment_count !== 1 ? "s" : ""}
                      {item.avg_stars != null && ` · ${formatStars(item.avg_stars)}★ avg`}
                      {seriesEpNote(item)}
                    </p>
                  }
                  actions={
                    <button
                      type="button"
                      onClick={() => setCommentsItem(item)}
                      className="btn-ghost px-2 py-1 text-xs"
                    >
                      <MessageSquare className="h-3 w-3" />
                      View comments
                    </button>
                  }
                />
              ))}
            </div>
          )}
        </Section>
      </div>

      {commentsItem && (
        <CommentsModal item={commentsItem} onClose={() => setCommentsItem(null)} />
      )}

      <Section title="Leaderboard" icon={Trophy}>
        {stats.user_leaderboard.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="pb-2 pr-4 font-medium">Member</th>
                  <th className="pb-2 pr-4 font-medium">Finished</th>
                  <th className="pb-2 pr-4 font-medium">Ratings given</th>
                  <th className="pb-2 font-medium">Avg given</th>
                </tr>
              </thead>
              <tbody>
                {stats.user_leaderboard.map((row, i) => (
                  <tr key={row.user_id} className="border-b border-white/5 last:border-0">
                    <td className="py-2.5 pr-4">
                      <span className="mr-2 text-slate-500">{i + 1}.</span>
                      <span className="font-medium text-white">{row.username}</span>
                    </td>
                    <td className="py-2.5 pr-4 text-slate-300">{row.watched_count}</td>
                    <td className="py-2.5 pr-4 text-slate-300">{row.ratings_given}</td>
                    <td className="py-2.5 text-amber-300">
                      {row.avg_rating_given != null ? `${formatStars(row.avg_rating_given)}★` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-slate-500">No members yet.</p>
        )}
      </Section>
    </div>
  );
}
