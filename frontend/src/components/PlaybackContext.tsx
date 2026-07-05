import { createContext, useCallback, useContext, useMemo } from "react";
import { api } from "../api";
import type { LibraryItem } from "../types";
import { useToast, type ToastKind } from "./Toast";

type ObsState = { connected: boolean; streaming: boolean };

type PlaybackContextValue = {
  obs: ObsState;
  playFromLibrary: (item: Pick<LibraryItem, "id" | "title" | "display_title">) => Promise<void>;
  queueFromLibrary: (item: Pick<LibraryItem, "id" | "title" | "display_title">) => Promise<void>;
};

const PlaybackContext = createContext<PlaybackContextValue | null>(null);

function titleLabel(item: Pick<LibraryItem, "title" | "display_title">) {
  return item.display_title || item.title || "Untitled";
}

export function PlaybackProvider({
  obs,
  onGoToQueue,
  children,
}: {
  obs: ObsState;
  onGoToQueue: () => void;
  children: React.ReactNode;
}) {
  const { push: pushToast } = useToast();

  const warnStream = useCallback(() => {
    if (!obs.connected) {
      pushToast("OBS is offline — friends won't see playback in VRChat.", "error");
      return;
    }
    if (!obs.streaming) {
      pushToast("Playback started — click Go live on Tonight so friends can watch.", "info");
    }
  }, [obs.connected, obs.streaming, pushToast]);

  const pushWithQueueAction = useCallback(
    (message: string, kind: ToastKind = "success") => {
      pushToast(message, kind, { label: "Open Queue", onClick: onGoToQueue });
    },
    [pushToast, onGoToQueue]
  );

  const playFromLibrary = useCallback(
    async (item: Pick<LibraryItem, "id" | "title" | "display_title">) => {
      try {
        const snap = await api.queueAdd(item.id);
        await api.play(snap.items.length - 1);
        pushWithQueueAction(`Now playing: ${titleLabel(item)}`);
        warnStream();
      } catch (err: unknown) {
        pushToast(err instanceof Error ? err.message : "Could not start playback", "error");
      }
    },
    [pushWithQueueAction, pushToast, warnStream]
  );

  const queueFromLibrary = useCallback(
    async (item: Pick<LibraryItem, "id" | "title" | "display_title">) => {
      try {
        await api.queueAdd(item.id);
        pushWithQueueAction(`Added to queue: ${titleLabel(item)}`);
      } catch (err: unknown) {
        pushToast(err instanceof Error ? err.message : "Could not add to queue", "error");
      }
    },
    [pushWithQueueAction, pushToast]
  );

  const value = useMemo(
    () => ({ obs, playFromLibrary, queueFromLibrary }),
    [obs, playFromLibrary, queueFromLibrary]
  );

  return <PlaybackContext.Provider value={value}>{children}</PlaybackContext.Provider>;
}

export function usePlayback() {
  const ctx = useContext(PlaybackContext);
  if (!ctx) throw new Error("usePlayback must be used within PlaybackProvider");
  return ctx;
}
