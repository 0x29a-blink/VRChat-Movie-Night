import { Download, ListPlus, Loader2, Play } from "lucide-react";
import { useState } from "react";
import type { LibraryItem } from "../types";
import { InLibraryChip } from "./InLibraryChip";
import { usePlayback } from "./PlaybackContext";

export function TitleMediaActions({
  onFindStreams,
  libraryMatch,
  compact = false,
  onPointerDown,
}: {
  onFindStreams?: () => void;
  libraryMatch?: LibraryItem | null;
  compact?: boolean;
  onPointerDown?: (e: React.PointerEvent | React.MouseEvent) => void;
}) {
  const { playFromLibrary, queueFromLibrary } = usePlayback();
  const [busy, setBusy] = useState(false);

  const playNow = async () => {
    if (!libraryMatch) return;
    setBusy(true);
    try {
      await playFromLibrary(libraryMatch);
    } finally {
      setBusy(false);
    }
  };

  const addToQueue = async () => {
    if (!libraryMatch) return;
    setBusy(true);
    try {
      await queueFromLibrary(libraryMatch);
    } finally {
      setBusy(false);
    }
  };

  if (!onFindStreams && !libraryMatch) return null;

  const cls = compact ? "btn-ghost px-1 py-0.5 text-[10px]" : "btn-ghost text-xs";

  return (
    <div className="flex flex-wrap items-center gap-1" onPointerDown={onPointerDown}>
      {libraryMatch && !compact && <InLibraryChip />}
      {libraryMatch && (
        <>
          <button type="button" disabled={busy} onClick={playNow} className={`${cls} border border-brand-500/30`}>
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
            {!compact && " Play"}
          </button>
          <button type="button" disabled={busy} onClick={addToQueue} className={cls}>
            <ListPlus className="h-3 w-3" />
            {!compact && " Queue"}
          </button>
        </>
      )}
      {onFindStreams && (
        <button type="button" onClick={onFindStreams} className={`${cls} border border-white/10`}>
          <Download className="h-3 w-3" />
          {!compact && " Streams"}
        </button>
      )}
    </div>
  );
}
