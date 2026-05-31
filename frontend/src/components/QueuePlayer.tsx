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
  GripVertical,
  Languages,
  Pause,
  Play,
  Radio,
  Rewind,
  FastForward,
  SkipBack,
  SkipForward,
  Square,
  Trash2,
  Volume2,
  X,
  Repeat,
  Copy,
  StopCircle,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { copyHlsUrl } from "../hlsUrl";
import { fmtMs } from "../format";
import type { PlayerState, QueueItem, QueueSnapshot } from "../types";
import { PlaybackTracksPanel } from "./PlaybackTracksPanel";
import { useToast } from "./Toast";

interface Props {
  queue: QueueSnapshot;
  player: PlayerState | null;
  obs: { connected: boolean; streaming: boolean };
  onObs: (o: { connected: boolean; streaming: boolean }) => void;
}

export function QueuePlayer({ queue, player, obs, onObs }: Props) {
  const { push: pushToast } = useToast();
  const [items, setItems] = useState<QueueItem[]>(queue.items);
  const [volume, setVolume] = useState(100);
  const [queueLoop, setQueueLoop] = useState(true);
  const volTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const act = (label: string, fn: () => Promise<unknown>) => async () => {
    try {
      await fn();
    } catch (err: unknown) {
      pushToast(err instanceof Error ? err.message : `${label} failed`, "error");
    }
  };

  useEffect(() => setItems(queue.items), [queue.items]);

  useEffect(() => {
    api.playerStatus().then((st) => {
      if (st.volume_percent != null) setVolume(st.volume_percent);
      if (st.queue_loop != null) setQueueLoop(st.queue_loop);
    });
  }, []);

  useEffect(() => {
    if (player?.volume_percent != null) setVolume(player.volume_percent);
    if (player?.queue_loop != null) setQueueLoop(player.queue_loop);
  }, [player?.volume_percent, player?.queue_loop]);

  const onVolumeChange = (pct: number) => {
    setVolume(pct);
    if (volTimer.current) clearTimeout(volTimer.current);
    volTimer.current = setTimeout(() => {
      api.setVolume(pct).catch((err: unknown) => {
        pushToast(err instanceof Error ? err.message : "Could not set volume", "error");
      });
    }, 120);
  };

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIdx = items.findIndex((i) => i.id === active.id);
    const newIdx = items.findIndex((i) => i.id === over.id);
    const next = arrayMove(items, oldIdx, newIdx);
    setItems(next);
    api.queueReorder(next.map((i) => i.id)).catch((err: unknown) => {
      pushToast(err instanceof Error ? err.message : "Could not reorder queue", "error");
    });
  };

  const playing = player?.media_state === "OBS_MEDIA_STATE_PLAYING";
  const cur = queue.current;
  const duration = player?.duration || cur?.duration ? player?.duration || 0 : 0;
  const cursor = player?.cursor || 0;
  const pct = duration > 0 ? (cursor / duration) * 100 : 0;

  const startStream = async () => {
    try {
      await api.obsStreamStart();
      onObs({ ...obs, streaming: true });
      pushToast("Stream is live — friends can watch in VRChat", "success");
    } catch (err: unknown) {
      pushToast(err instanceof Error ? err.message : "Could not start stream", "error");
    }
  };

  const stopStream = async () => {
    try {
      await api.obsStreamStop();
      onObs({ ...obs, streaming: false });
      pushToast("Stream stopped", "info");
    } catch (err: unknown) {
      pushToast(err instanceof Error ? err.message : "Could not stop stream", "error");
    }
  };

  const copyStreamUrl = async () => {
    try {
      await copyHlsUrl();
      pushToast("HLS URL copied to clipboard", "success");
    } catch {
      pushToast("Could not copy URL", "error");
    }
  };

  const seekFromBar = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    api.seek(Math.round(ratio * duration)).catch((err: unknown) => {
      pushToast(err instanceof Error ? err.message : "Could not seek", "error");
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Queue &amp; Player</h1>
          <p className="mt-1 text-sm text-slate-400">Drive the OBS stream your friends see in VRChat.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={copyStreamUrl} className="btn-ghost text-sm">
            <Copy className="h-4 w-4" /> Copy HLS URL
          </button>
          {!obs.streaming ? (
            <button onClick={startStream} disabled={!obs.connected} className="btn-primary">
              <Radio className="h-4 w-4" /> Go live
            </button>
          ) : (
            <button onClick={stopStream} disabled={!obs.connected} className="btn-ghost border border-red-500/30 text-red-300">
              <StopCircle className="h-4 w-4" /> Stop live
            </button>
          )}
        </div>
      </div>

      {!obs.connected && (
        <div className="rounded-xl bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
          OBS WebSocket is not connected. Check OBS is running, then review the Movie Night checklist.
        </div>
      )}

      {/* Now playing / transport */}
      <div className="card overflow-hidden p-5">
        <div className="flex gap-4">
          <div className="grid h-24 w-40 shrink-0 place-items-center overflow-hidden rounded-xl bg-ink-800">
            {cur?.thumbnail ? (
              <img src={cur.thumbnail} alt="" className="h-full w-full object-cover" />
            ) : (
              <Play className="h-8 w-8 text-slate-600" />
            )}
          </div>
          <div className="flex min-w-0 flex-1 flex-col justify-between">
            <div>
              <div className="text-xs uppercase tracking-wide text-slate-500">
                {playing ? "Now playing" : cur ? "Paused" : "Nothing playing"}
              </div>
              <div className="mt-0.5 truncate text-lg font-medium" title={cur?.title}>
                {cur?.title || "—"}
              </div>
            </div>

            {/* Scrubber */}
            <div>
              <div
                onClick={seekFromBar}
                className="group h-2.5 w-full cursor-pointer overflow-hidden rounded-full bg-white/5"
              >
                <div
                  className="h-full rounded-full bg-gradient-to-r from-brand-500 to-accent-500"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <div className="mt-1 flex justify-between text-xs text-slate-500">
                <span>{fmtMs(cursor)}</span>
                <span>{fmtMs(duration)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Controls */}
        <div className="mt-5 flex items-center justify-center gap-2">
          <Ctrl onClick={act("Skip back", () => api.skip(-10))} title="Back 10s">
            <Rewind className="h-5 w-5" />
            <span className="text-[10px]">10</span>
          </Ctrl>
          <Ctrl onClick={act("Skip back", () => api.skip(-5))} title="Back 5s">
            <Rewind className="h-4 w-4" />
            <span className="text-[10px]">5</span>
          </Ctrl>
          <Ctrl onClick={act("Previous", () => api.prev())} title="Previous">
            <SkipBack className="h-5 w-5" />
          </Ctrl>
          <button
            onClick={act(cur ? "Toggle playback" : "Play", () => (cur ? api.toggle() : api.play()))}
            className="grid h-14 w-14 place-items-center rounded-full bg-brand-500 text-white shadow-glow transition-colors hover:bg-brand-600"
            title={playing ? "Pause" : "Play"}
          >
            {playing ? <Pause className="h-6 w-6" /> : <Play className="h-6 w-6 translate-x-0.5" />}
          </button>
          <Ctrl onClick={act("Next", () => api.next())} title="Next">
            <SkipForward className="h-5 w-5" />
          </Ctrl>
          <Ctrl onClick={act("Skip forward", () => api.skip(5))} title="Forward 5s">
            <FastForward className="h-4 w-4" />
            <span className="text-[10px]">5</span>
          </Ctrl>
          <Ctrl onClick={act("Skip forward", () => api.skip(10))} title="Forward 10s">
            <FastForward className="h-5 w-5" />
            <span className="text-[10px]">10</span>
          </Ctrl>
          <Ctrl onClick={act("Stop", () => api.stop())} title="Stop">
            <Square className="h-4 w-4" />
          </Ctrl>
        </div>

        <div className="mt-5 flex flex-col gap-4 border-t border-white/5 pt-4 sm:flex-row sm:items-center sm:justify-between">
          <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
            <Volume2 className="h-4 w-4 shrink-0 text-slate-500" />
            <span className="w-14 shrink-0 text-xs text-slate-400">Volume</span>
            <input
              type="range"
              min={0}
              max={100}
              value={volume}
              onChange={(e) => onVolumeChange(Number(e.target.value))}
              disabled={!obs.connected}
              className="h-2 min-w-0 flex-1 cursor-pointer appearance-none rounded-full bg-white/10 accent-brand-500 disabled:opacity-40"
            />
            <span className="w-10 shrink-0 text-right text-xs tabular-nums text-slate-400">
              {volume}%
            </span>
          </label>
          <label className="flex cursor-pointer items-center gap-2.5 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={queueLoop}
              onChange={(e) => {
                const on = e.target.checked;
                setQueueLoop(on);
                api.setQueueLoop(on).catch((err: unknown) => {
                  pushToast(err instanceof Error ? err.message : "Could not update loop setting", "error");
                });
              }}
              className="h-4 w-4 rounded accent-brand-500"
            />
            <Repeat className="h-4 w-4 text-slate-500" />
            Loop queue
          </label>
        </div>

        {cur?.library_path && (
          <PlaybackTracksPanel
            libraryPath={cur.library_path}
            isNowPlaying
            disabled={!obs.connected}
          />
        )}
      </div>

      {/* Queue list */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
            Up next · {items.length}
          </h2>
          {items.length > 0 && (
            <button onClick={act("Clear queue", () => api.queueClear())} className="btn-ghost text-xs text-slate-400">
              <Trash2 className="h-3.5 w-3.5" /> Clear queue
            </button>
          )}
        </div>

        {items.length === 0 ? (
          <div className="card p-10 text-center text-slate-500">
            Queue is empty. Add videos from the Library.
          </div>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
              <div className="space-y-2">
                {items.map((item, idx) => (
                  <Row
                    key={item.id}
                    item={item}
                    index={idx}
                    isCurrent={idx === queue.current_index}
                    obsConnected={obs.connected}
                    onPlay={act("Play", () => api.play(idx))}
                    onRemove={act("Remove from queue", () => api.queueRemove(item.id))}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </section>
    </div>
  );
}

function Ctrl({
  children,
  onClick,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="grid h-11 w-11 place-items-center rounded-full bg-white/5 text-slate-200 transition-colors hover:bg-white/10"
    >
      <span className="flex flex-col items-center leading-none">{children}</span>
    </button>
  );
}

function Row({
  item,
  index,
  isCurrent,
  obsConnected,
  onPlay,
  onRemove,
}: {
  item: QueueItem;
  index: number;
  isCurrent: boolean;
  obsConnected: boolean;
  onPlay: () => void;
  onRemove: () => void;
}) {
  const [tracksOpen, setTracksOpen] = useState(false);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
  });
  const canEditTracks = !!item.library_path?.trim();

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`card overflow-hidden ${isDragging ? "opacity-60" : ""} ${
        isCurrent ? "ring-1 ring-brand-500/60" : ""
      }`}
    >
      <div className="flex items-center gap-3 p-2.5">
        <button
          {...attributes}
          {...listeners}
          className="cursor-grab touch-none rounded-lg p-1 text-slate-500 hover:text-slate-300"
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <span className="w-5 text-center text-xs text-slate-500">{index + 1}</span>
        <div className="h-10 w-16 shrink-0 overflow-hidden rounded-md bg-ink-800">
          {item.thumbnail && <img src={item.thumbnail} alt="" className="h-full w-full object-cover" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm" title={item.title}>
            {item.title}
          </div>
          {isCurrent && <div className="text-[11px] text-brand-300">Playing</div>}
        </div>
        {canEditTracks && (
          <button
            type="button"
            onClick={() => setTracksOpen((o) => !o)}
            className={`rounded-lg p-2 hover:bg-white/10 ${
              tracksOpen ? "text-brand-300" : "text-slate-400 hover:text-brand-300"
            }`}
            title={tracksOpen ? "Hide audio & subtitles" : "Audio & subtitles (before play)"}
          >
            <Languages className="h-4 w-4" />
          </button>
        )}
        <button
          onClick={onPlay}
          className="rounded-lg p-2 text-slate-400 hover:bg-white/10 hover:text-brand-300"
          title="Play this"
        >
          <Play className="h-4 w-4" />
        </button>
        <button
          onClick={onRemove}
          className="rounded-lg p-2 text-slate-400 hover:bg-white/10 hover:text-red-300"
          title="Remove"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      {tracksOpen && canEditTracks && (
        <div className="border-t border-white/5 px-2.5 pb-2.5">
          <PlaybackTracksPanel
            libraryPath={item.library_path}
            isNowPlaying={isCurrent}
            disabled={isCurrent && !obsConnected}
            compact
          />
        </div>
      )}
    </div>
  );
}
