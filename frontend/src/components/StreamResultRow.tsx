import { Check, Clock, Copy, Download, HardDriveDownload, Zap } from "lucide-react";
import type { StreamResult } from "../types";
import { streamKey } from "../streamListUtils";

type StreamResultRowProps = {
  stream: StreamResult;
  index: number;
  grabbed: Set<string>;
  onGrabCached: (s: StreamResult) => void;
  onGrabCache: (s: StreamResult) => void;
  showLocalDownload?: boolean;
  onLocalDownload?: (s: StreamResult) => void;
  onCopyLink?: (s: StreamResult) => void;
};

type StreamActionState = {
  done: boolean;
  hasUrl: boolean;
  canInstant: boolean;
  canLocalSave: boolean;
  canCopyLink: boolean;
  canCache: boolean;
};

function buildActionState(
  stream: StreamResult,
  index: number,
  grabbed: Set<string>,
  showLocalDownload?: boolean,
  onLocalDownload?: (s: StreamResult) => void,
  onCopyLink?: (s: StreamResult) => void
): StreamActionState {
  const key = streamKey(stream) || String(index);
  const done = grabbed.has(key);
  const hasUrl = !!(stream.url || "").trim();
  const hasTorboxRef = hasUrl || !!stream.magnet || !!stream.info_hash || !!stream.cached;

  return {
    done,
    hasUrl,
    canInstant: stream.cached && stream.playable !== false && hasUrl,
    canLocalSave: !!showLocalDownload && hasTorboxRef && !!onLocalDownload,
    canCopyLink: !!showLocalDownload && hasTorboxRef && !!onCopyLink,
    canCache: !stream.cached && (!!stream.cacheable || !!stream.playback_cacheable),
  };
}

function langTagClass(tag: string): string {
  switch (tag) {
    case "Dub":
      return "bg-sky-500/15 text-sky-300";
    case "Sub":
      return "bg-violet-500/15 text-violet-300";
    case "Dual":
      return "bg-indigo-500/15 text-indigo-300";
    case "Hardsub":
      return "bg-rose-500/15 text-rose-300";
    default:
      return "bg-teal-500/15 text-teal-300";
  }
}

function StreamQualityBadges({ stream }: { stream: StreamResult }) {
  return (
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
  );
}

function StreamTitle({ stream }: { stream: StreamResult }) {
  const title = stream.name || stream.filename || "Stream";

  return (
    <>
      <div className="truncate text-sm text-slate-200" title={stream.name}>
        {title}
      </div>
      {stream.filename && (
        <div className="mt-0.5 truncate text-[10px] text-slate-500" title={stream.filename}>
          {stream.filename}
        </div>
      )}
      {stream.filename?.toLowerCase().endsWith(".iso") && (
        <div className="mt-0.5 text-[10px] text-amber-400/90">
          Disc image (.iso) — often a game installer, not a movie. Prefer .mkv or .mp4 streams.
        </div>
      )}
    </>
  );
}

function StreamMetaBadges({ stream }: { stream: StreamResult }) {
  const title = stream.name || stream.filename || "";
  const tags = [...(stream.visual_tags || []), ...(stream.audio_tags || [])];
  const visibleTags = tags.slice(0, 6);
  const hiddenTagCount = tags.length - visibleTags.length;

  return (
    <div className="mt-1 flex flex-wrap gap-1.5 text-[11px]">
      {stream.provider && !title.includes(stream.provider) && (
        <span className="chip bg-white/5 text-slate-400">{stream.provider}</span>
      )}
      {stream.codec && <span className="chip bg-white/5 text-slate-400">{stream.codec}</span>}
      {stream.hdr && <span className="chip bg-fuchsia-500/15 text-fuchsia-300">{stream.hdr}</span>}
      {stream.source && <span className="chip bg-white/5 text-slate-400">{stream.source}</span>}
      {stream.indexer && <span className="chip bg-white/5 text-slate-400">{stream.indexer}</span>}
      {stream.network && <span className="chip bg-white/5 text-slate-400">{stream.network}</span>}
      {visibleTags.map((tag, i) => (
        <span key={`${tag}-${i}`} className="chip bg-white/5 text-slate-400">
          {tag}
        </span>
      ))}
      {hiddenTagCount > 0 && (
        <span className="chip bg-white/5 text-slate-500" title={tags.slice(6).join(", ")}>
          +{hiddenTagCount}
        </span>
      )}
      {stream.languages && stream.languages.length > 0 && (
        <span className="chip bg-emerald-500/10 text-emerald-300" title="Audio languages (AIOStreams)">
          🌎 {stream.languages.join(" | ")}
        </span>
      )}
      {stream.subtitle_langs && stream.subtitle_langs.length > 0 && (
        <span className="chip bg-amber-500/10 text-amber-200" title="Subtitle languages (AIOStreams)">
          📝 {stream.subtitle_langs.join(" | ")}
        </span>
      )}
      {stream.release_group && (
        <span className="chip bg-white/5 text-slate-400">{stream.release_group}</span>
      )}
      {(stream.lang_tags || []).map((tag) => (
        <span key={tag} className={`chip ${langTagClass(tag)}`}>
          {tag}
        </span>
      ))}
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
  );
}

function DownloadButton({
  done,
  stream,
  onGrabCached,
}: {
  done: boolean;
  stream: StreamResult;
  onGrabCached: (s: StreamResult) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onGrabCached(stream)}
      disabled={done}
      className={`whitespace-nowrap ${done ? "btn-ghost text-emerald-300" : "btn-primary"}`}
    >
      {done ? <Check className="h-4 w-4" /> : <Download className="h-4 w-4" />}
      {done ? "Queued" : "Download"}
    </button>
  );
}

function CacheButton({
  done,
  stream,
  onGrabCache,
}: {
  done: boolean;
  stream: StreamResult;
  onGrabCache: (s: StreamResult) => void;
}) {
  const title = stream.playback_cacheable
    ? "Request cache via AIOStreams playback, then download when ready (TorBox API key required)"
    : "Add to TorBox, wait until cached, then download to library";

  return (
    <button
      type="button"
      onClick={() => onGrabCache(stream)}
      disabled={done}
      title={title}
      className={`whitespace-nowrap ${done ? "btn-ghost text-emerald-300" : "btn-ghost border border-amber-500/30 text-amber-200"}`}
    >
      {done ? <Check className="h-4 w-4" /> : <Clock className="h-4 w-4" />}
      {done ? "Queued" : "Cache & download"}
    </button>
  );
}

function StreamActions({
  stream,
  onGrabCached,
  onGrabCache,
  showLocalDownload,
  onLocalDownload,
  onCopyLink,
  state,
}: {
  stream: StreamResult;
  onGrabCached: (s: StreamResult) => void;
  onGrabCache: (s: StreamResult) => void;
  showLocalDownload?: boolean;
  onLocalDownload?: (s: StreamResult) => void;
  onCopyLink?: (s: StreamResult) => void;
  state: StreamActionState;
}) {
  return (
    <div className="flex shrink-0 flex-col gap-1.5 sm:ml-auto">
      {state.canInstant && <DownloadButton done={state.done} stream={stream} onGrabCached={onGrabCached} />}
      {state.canLocalSave && (
        <button
          type="button"
          onClick={() => onLocalDownload?.(stream)}
          title="Open TorBox CDN link in browser (nothing streamed from host PC)"
          className="btn-ghost whitespace-nowrap border border-white/10 text-xs text-slate-300"
        >
          <HardDriveDownload className="h-4 w-4" />
          TorBox download
        </button>
      )}
      {state.canCopyLink && (
        <button
          type="button"
          onClick={() => onCopyLink?.(stream)}
          title="Copy TorBox CDN link (may expire; host refreshes when possible)"
          className="btn-ghost whitespace-nowrap border border-white/10 text-xs text-slate-300"
        >
          <Copy className="h-4 w-4" />
          Copy link
        </button>
      )}
      {state.hasUrl && !state.canInstant && !state.canLocalSave && showLocalDownload && (
        <span
          className="max-w-[10rem] text-center text-[10px] text-amber-300/90"
          title="Link may have expired — use Copy link or refresh streams"
        >
          Expired / uncached link
        </span>
      )}
      {state.canCache && <CacheButton done={state.done} stream={stream} onGrabCache={onGrabCache} />}
      {!state.canInstant &&
        !state.canCache &&
        !stream.cached &&
        (stream.seeders > 0 || (stream.name || "").includes("TB")) && (
          <span
            className="max-w-[9rem] text-center text-[10px] leading-snug text-slate-500"
            title="No magnet in stream JSON — add TorBox API key in Settings, or pick a cached row"
          >
            No cache action (missing magnet)
          </span>
        )}
    </div>
  );
}

export function StreamResultRow({
  stream,
  index,
  grabbed,
  onGrabCached,
  onGrabCache,
  showLocalDownload,
  onLocalDownload,
  onCopyLink,
}: StreamResultRowProps) {
  const state = buildActionState(stream, index, grabbed, showLocalDownload, onLocalDownload, onCopyLink);

  return (
    <div className="card flex min-w-0 flex-col gap-3 p-3 sm:flex-row sm:items-center">
      <StreamQualityBadges stream={stream} />
      <div className="min-w-0 flex-1">
        <StreamTitle stream={stream} />
        <StreamMetaBadges stream={stream} />
      </div>
      <StreamActions
        stream={stream}
        onGrabCached={onGrabCached}
        onGrabCache={onGrabCache}
        showLocalDownload={showLocalDownload}
        onLocalDownload={onLocalDownload}
        onCopyLink={onCopyLink}
        state={state}
      />
    </div>
  );
}
