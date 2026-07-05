import {
  ChevronDown,
  ChevronUp,
  Clapperboard,
  Download,
  ListMinus,
  ListPlus,
  ListX,
  LogIn,
  SkipForward,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { AppEvent } from "../types";

const KIND_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  queue_add: ListPlus,
  queue_remove: ListMinus,
  queue_clear: ListX,
  auto_skip: SkipForward,
  download_start: Download,
  download_complete: Download,
  download_failed: Download,
  login: LogIn,
  library_delete: Trash2,
};

function iconFor(kind: string) {
  return KIND_ICON[kind] || Clapperboard;
}

function describe(event: AppEvent): string {
  const who = event.username || "Someone";
  switch (event.kind) {
    case "queue_add":
      return `${who} queued "${event.title}"`;
    case "queue_remove":
      return `${who} removed "${event.title}" from the queue`;
    case "queue_clear":
      return `${who} cleared the queue`;
    case "auto_skip":
      return `Skipped "${event.title}"${event.detail ? ` (${event.detail})` : ""}`;
    case "download_start":
      return `${who} started downloading "${event.title}"`;
    case "download_complete":
      return `Download complete: "${event.title}"`;
    case "download_failed":
      return `Download failed: "${event.title}"${event.detail ? ` — ${event.detail}` : ""}`;
    case "login":
      return `${event.title} logged in`;
    case "library_delete":
      return `${who} deleted "${event.title}"`;
    default:
      return event.title;
  }
}

function relativeTime(iso: string | null): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diffSec = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (diffSec < 5) return "just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  return `${diffDay}d ago`;
}

interface Props {
  /** Latest event received over the WS (activity_event); prepended live when set. */
  liveEvent?: AppEvent | null;
}

export function ActivityFeed({ liveEvent }: Props) {
  const [open, setOpen] = useState(false);
  const [events, setEvents] = useState<AppEvent[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async (beforeId?: number) => {
    setLoading(true);
    try {
      const res = await api.events({ limit: 50, beforeId });
      setEvents((prev) => (beforeId ? [...prev, ...res.events] : res.events));
      setHasMore(res.has_more);
      setLoaded(true);
    } catch {
      /* silent — activity feed is non-critical */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open && !loaded) load();
  }, [open, loaded, load]);

  useEffect(() => {
    if (!liveEvent || !loaded) return;
    setEvents((prev) => (prev.some((e) => e.id === liveEvent.id) ? prev : [liveEvent, ...prev]));
  }, [liveEvent, loaded]);

  return (
    <section className="card overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
            Activity
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">Who queued, skipped, or downloaded what.</p>
        </div>
        {open ? (
          <ChevronUp className="h-4 w-4 shrink-0 text-slate-500" />
        ) : (
          <ChevronDown className="h-4 w-4 shrink-0 text-slate-500" />
        )}
      </button>

      {open && (
        <div className="border-t border-white/5 px-4 py-3">
          {events.length === 0 && !loading ? (
            <div className="py-4 text-center text-sm text-slate-500">No activity yet.</div>
          ) : (
            <ul className="space-y-2.5">
              {events.map((event) => {
                const Icon = iconFor(event.kind);
                return (
                  <li key={event.id} className="flex items-start gap-2.5 text-sm">
                    <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-500" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-slate-300">{describe(event)}</div>
                      <div className="text-xs text-slate-600">{relativeTime(event.created_at)}</div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {hasMore && (
            <button
              type="button"
              onClick={() => load(events[events.length - 1]?.id)}
              disabled={loading}
              className="btn-ghost mt-3 w-full justify-center text-xs"
            >
              {loading ? "Loading…" : "Load more"}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
