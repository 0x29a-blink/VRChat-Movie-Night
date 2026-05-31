import { Check, Clock, Download, Zap } from "lucide-react";
import type { StreamResult } from "../types";
import { streamKey } from "../streamListUtils";

export function StreamResultRow({
  stream,
  index,
  grabbed,
  onGrabCached,
  onGrabCache,
}: {
  stream: StreamResult;
  index: number;
  grabbed: Set<string>;
  onGrabCached: (s: StreamResult) => void;
  onGrabCache: (s: StreamResult) => void;
}) {
  const key = streamKey(stream) || String(index);
  const done = grabbed.has(key);
  const canInstant = stream.cached && stream.playable !== false && !!stream.url;
  const canCache = !stream.cached && (!!stream.cacheable || !!stream.playback_cacheable);

  return (
    <div className="card flex min-w-0 flex-col gap-3 p-3 sm:flex-row sm:items-center">
      <div className="flex w-20 shrink-0 flex-col items-center gap-1">
        {stream.resolution && (
          <span className="chip bg-brand-500/20 text-brand-300">{stream.resolution}</span>
        )}
        {stream.cached && (
          <span className="chip bg-amber-500/15 text-amber-300">
            <Zap className="mr-0.5 h-3 w-3" /> cached
          </span>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="truncate text-sm text-slate-200" title={stream.name}>
          {stream.name || stream.filename || "Stream"}
        </div>
        {stream.filename && (
          <div className="mt-0.5 truncate text-[10px] text-slate-500" title={stream.filename}>
            {stream.filename}
          </div>
        )}
        <div className="mt-1 flex flex-wrap gap-1.5 text-[11px]">
          {stream.provider && !stream.name.includes(stream.provider) && (
            <span className="chip bg-white/5 text-slate-400">{stream.provider}</span>
          )}
          {stream.codec && <span className="chip bg-white/5 text-slate-400">{stream.codec}</span>}
          {stream.hdr && <span className="chip bg-fuchsia-500/15 text-fuchsia-300">{stream.hdr}</span>}
          {stream.source && <span className="chip bg-white/5 text-slate-400">{stream.source}</span>}
          {stream.size_gb > 0 && (
            <span className="chip bg-white/5 text-slate-400">{stream.size_gb} GB</span>
          )}
          {!stream.cached && (
            <span
              className={`chip ${
                stream.seeders > 0 ? "bg-white/5 text-slate-400" : "bg-amber-500/10 text-amber-300"
              }`}
            >
              {stream.seeders > 0 ? `${stream.seeders} indexer seeds` : "seeds unknown"}
            </span>
          )}
          {stream.playable === false && (
            <span className="chip bg-red-500/10 text-red-300">not cached</span>
          )}
        </div>
      </div>

      <div className="flex shrink-0 flex-col gap-1.5 sm:ml-auto">
        {canInstant && (
          <button
            type="button"
            onClick={() => onGrabCached(stream)}
            disabled={done}
            className={`whitespace-nowrap ${done ? "btn-ghost text-emerald-300" : "btn-primary"}`}
          >
            {done ? <Check className="h-4 w-4" /> : <Download className="h-4 w-4" />}
            {done ? "Queued" : "Download"}
          </button>
        )}
        {canCache && (
          <button
            type="button"
            onClick={() => onGrabCache(stream)}
            disabled={done}
            title={
              stream.playback_cacheable
                ? "Request cache via AIOStreams playback, then download when ready (TorBox API key required)"
                : "Add to TorBox, wait until cached, then download to library"
            }
            className={`whitespace-nowrap ${done ? "btn-ghost text-emerald-300" : "btn-ghost border border-amber-500/30 text-amber-200"}`}
          >
            {done ? <Check className="h-4 w-4" /> : <Clock className="h-4 w-4" />}
            {done ? "Queued" : "Cache & download"}
          </button>
        )}
        {!canInstant && !canCache && !stream.cached && (stream.seeders > 0 || stream.name.includes("TB")) && (
          <span
            className="max-w-[9rem] text-center text-[10px] leading-snug text-slate-500"
            title="No magnet in stream JSON — add TorBox API key in Settings, or pick a cached row"
          >
            No cache action (missing magnet)
          </span>
        )}
      </div>
    </div>
  );
}
