import { BookmarkPlus, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../api";
import type { WatchlistGroup } from "../types";

export interface WatchlistAddPayload {
  kind: "movie" | "series" | "episode";
  tmdb_id?: number;
  media_type?: string;
  season?: number;
  episode?: number;
  title?: string;
  poster?: string;
  year?: string;
  overview?: string;
  air_date?: string;
  parent_id?: number;
  library_item_id?: number;
}

export function AddToWatchlistButton({
  payload,
  label = "Watchlist",
  className = "btn-ghost text-xs",
}: {
  payload: WatchlistAddPayload;
  label?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [groups, setGroups] = useState<WatchlistGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    api
      .watchlistGroups()
      .then((r) => setGroups(r.groups))
      .finally(() => setLoading(false));
  }, [open]);

  const openModal = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setOpen(true);
    setMsg("");
  };

  const add = async (groupId: number | null) => {
    setBusy(true);
    setMsg("");
    try {
      await api.watchlistAddItem({ ...payload, group_id: groupId ?? undefined });
      setMsg("Added!");
      setTimeout(() => setOpen(false), 600);
    } catch (err: unknown) {
      setMsg(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  const modal =
    open &&
    createPortal(
      <div
        className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4"
        onClick={() => setOpen(false)}
      >
        <div
          className="card w-full max-w-sm p-5"
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <h3 className="text-sm font-semibold">Add to watchlist</h3>
          <p className="mt-1 truncate text-xs text-slate-400">{payload.title}</p>
          {payload.kind === "series" && (
            <p className="mt-1 text-[10px] text-slate-500">All episodes will be added from TMDB.</p>
          )}
          {loading ? (
            <div className="flex justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
            </div>
          ) : (
            <div className="mt-4 space-y-2">
              <button type="button" disabled={busy} onClick={() => add(null)} className="btn-ghost w-full justify-start">
                Ungrouped
              </button>
              {groups.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  disabled={busy}
                  onClick={() => add(g.id)}
                  className="btn-ghost w-full justify-start"
                >
                  {g.name}
                </button>
              ))}
            </div>
          )}
          {msg && <p className="mt-2 text-xs text-emerald-300">{msg}</p>}
          <button type="button" onClick={() => setOpen(false)} className="btn-ghost mt-4 w-full">
            Close
          </button>
        </div>
      </div>,
      document.body
    );

  return (
    <>
      <button type="button" onClick={openModal} className={className}>
        <BookmarkPlus className="h-3.5 w-3.5" /> {label}
      </button>
      {modal}
    </>
  );
}
