import { Loader2 } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "./api";
import type { WatchlistGroup } from "./types";

export interface WatchlistAddPayload {
  kind: "movie" | "series" | "episode" | "collection";
  tmdb_id?: number;
  stremio_id?: string;
  series_title?: string;
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

type WatchlistAddContextValue = {
  openWatchlistAdd: (payload: WatchlistAddPayload) => void;
};

const WatchlistAddContext = createContext<WatchlistAddContextValue | null>(null);

function WatchlistAddModal({
  payload,
  onClose,
}: {
  payload: WatchlistAddPayload;
  onClose: () => void;
}) {
  const [groups, setGroups] = useState<WatchlistGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    setLoading(true);
    setMsg("");
    api
      .watchlistGroups()
      .then((r) => setGroups(r.groups))
      .finally(() => setLoading(false));
  }, [payload]);

  const add = async (groupId: number | null) => {
    setBusy(true);
    setMsg("");
    try {
      await api.watchlistAddItem({ ...payload, group_id: groupId ?? undefined });
      setMsg("Added!");
      setTimeout(onClose, 600);
    } catch (err: unknown) {
      setMsg(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="card w-full max-w-sm p-5"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h3 className="text-sm font-semibold">Add to watchlist</h3>
        <p className="mt-1 truncate text-xs text-slate-400">
          {payload.kind === "episode" && payload.series_title
            ? `${payload.series_title} · ${payload.title}`
            : payload.title}
        </p>
        {payload.kind === "collection" && payload.tmdb_id && (
          <p className="mt-1 text-[10px] text-slate-500">
            Adds the whole franchise as one wheel slot — movies inside, no episode bulk import.
          </p>
        )}
        {payload.kind === "series" && payload.tmdb_id && !payload.stremio_id && (
          <p className="mt-1 text-[10px] text-slate-500">Imports all episodes from TMDB (large shows).</p>
        )}
        {payload.kind === "series" && payload.stremio_id && (
          <p className="mt-1 text-[10px] text-slate-500">Adds the series — add episodes from Search as you go.</p>
        )}
        {payload.kind === "episode" && (
          <p className="mt-1 text-[10px] text-slate-500">Adds under the series row; creates the show if needed.</p>
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
        <button type="button" onClick={onClose} className="btn-ghost mt-4 w-full">
          Close
        </button>
      </div>
    </div>,
    document.body
  );
}

export function WatchlistAddProvider({ children }: { children: React.ReactNode }) {
  const [payload, setPayload] = useState<WatchlistAddPayload | null>(null);
  const openWatchlistAdd = useCallback((next: WatchlistAddPayload) => setPayload(next), []);
  const close = useCallback(() => setPayload(null), []);

  return (
    <WatchlistAddContext.Provider value={{ openWatchlistAdd }}>
      {children}
      {payload && <WatchlistAddModal payload={payload} onClose={close} />}
    </WatchlistAddContext.Provider>
  );
}

export function useWatchlistAdd() {
  const ctx = useContext(WatchlistAddContext);
  if (!ctx) throw new Error("useWatchlistAdd must be used within WatchlistAddProvider");
  return ctx;
}
