import type { Dispatch, SetStateAction } from "react";
import { useCallback, useEffect, useRef } from "react";
import { useWebSocket, type WsStatus } from "./ws";
import type { AppEvent, Job, MovieNightSession, PlayerState, QueueSnapshot } from "./types";
import type { ToastKind } from "./components/Toast";

type PushToast = (message: string, kind?: ToastKind) => void;

type UseAppRealtimeArgs = {
  authed: boolean;
  pushToast: PushToast;
  refreshAll: () => void;
  refreshChecklistIssues: () => void;
  setJobs: Dispatch<SetStateAction<Job[]>>;
  setQueue: Dispatch<SetStateAction<QueueSnapshot>>;
  setPlayer: Dispatch<SetStateAction<PlayerState | null>>;
  setLibVersion: Dispatch<SetStateAction<number>>;
  setWatchlistVersion: Dispatch<SetStateAction<number>>;
  setLibraryScanning: Dispatch<SetStateAction<boolean>>;
  onActivityEvent?: (event: AppEvent) => void;
  onSessionUpdate?: (session: MovieNightSession) => void;
};

function upsertJob(jobs: Job[], job: Job): Job[] {
  const idx = jobs.findIndex((j) => j.id === job.id);
  if (idx === -1) return [job, ...jobs];
  const copy = [...jobs];
  copy[idx] = job;
  return copy;
}

export function useAppRealtime({
  authed,
  pushToast,
  refreshAll,
  refreshChecklistIssues,
  setJobs,
  setQueue,
  setPlayer,
  setLibVersion,
  setWatchlistVersion,
  setLibraryScanning,
  onActivityEvent,
  onSessionUpdate,
}: UseAppRealtimeArgs): WsStatus {
  const jobStatusRef = useRef<Record<string, string>>({});
  const linkedToastRef = useRef<{ title: string; timer: number } | null>(null);
  const prevWsStatusRef = useRef<WsStatus>("disconnected");

  const bumpLibraryViews = useCallback(() => {
    setLibVersion((v) => v + 1);
    setWatchlistVersion((v) => v + 1);
  }, [setLibVersion, setWatchlistVersion]);

  const handleDownloadUpdate = useCallback(
    (job: Job) => {
      const prevStatus = jobStatusRef.current[job.id];
      jobStatusRef.current[job.id] = job.status;

      if (job.status === "completed" && prevStatus && prevStatus !== "completed") {
        if (job.link_tmdb_id) {
          if (linkedToastRef.current) window.clearTimeout(linkedToastRef.current.timer);
          linkedToastRef.current = {
            title: job.title,
            timer: window.setTimeout(() => {
              pushToast(`Download complete: ${job.title}`, "success");
              linkedToastRef.current = null;
            }, 2500),
          };
        } else {
          pushToast(`Download complete: ${job.title}`, "success");
        }
        bumpLibraryViews();
      } else if (job.status === "failed" && prevStatus && prevStatus !== "failed") {
        pushToast(`Download failed: ${job.title}`, "error");
      }

      setJobs((prev) => upsertJob(prev, job));
    },
    [bumpLibraryViews, pushToast, setJobs]
  );

  const handleLibraryUpdate = useCallback(
    (data: any) => {
      bumpLibraryViews();
      if (data?.reason !== "download_linked" || !data?.title) return;

      if (linkedToastRef.current) {
        window.clearTimeout(linkedToastRef.current.timer);
        linkedToastRef.current = null;
        pushToast(`Download complete & linked: ${data.title}`, "success");
      } else {
        pushToast(`Linked to library: ${data.title}`, "success");
      }
    },
    [bumpLibraryViews, pushToast]
  );

  const handleMessage = useCallback(
    (event: string, data: any) => {
      switch (event) {
        case "download_update":
          handleDownloadUpdate(data);
          break;
        case "download_removed":
          delete jobStatusRef.current[data.id];
          setJobs((prev) => prev.filter((j) => j.id !== data.id));
          break;
        case "queue_update":
          setQueue(data);
          break;
        case "player_update":
          setPlayer(data);
          if (data?.current_index !== undefined) {
            setQueue((q) => ({ ...q, current_index: data.current_index, current: data.current }));
          }
          break;
        case "library_update":
          handleLibraryUpdate(data);
          break;
        case "player_warning":
          pushToast(`Skipped ${data?.title || "current item"}: ${data?.reason || "playback issue"}`, "error");
          break;
        case "library_scan_started":
          setLibraryScanning(true);
          break;
        case "library_scan_finished":
          setLibraryScanning(false);
          if (data?.ok === false) pushToast(`Library scan failed: ${data?.error || "unknown error"}`, "error");
          break;
        case "activity_event":
          onActivityEvent?.(data as AppEvent);
          break;
        case "session_update":
          onSessionUpdate?.(data as MovieNightSession);
          break;
      }
    },
    [
      handleDownloadUpdate,
      handleLibraryUpdate,
      pushToast,
      setJobs,
      setPlayer,
      setQueue,
      setLibraryScanning,
      onActivityEvent,
      onSessionUpdate,
    ]
  );

  const wsStatus = useWebSocket(authed, handleMessage);

  useEffect(() => {
    const prev = prevWsStatusRef.current;
    prevWsStatusRef.current = wsStatus;
    if (authed && wsStatus === "connected" && prev === "reconnecting") {
      refreshAll();
      refreshChecklistIssues();
      bumpLibraryViews();
    }
  }, [authed, wsStatus, refreshAll, refreshChecklistIssues, bumpLibraryViews]);

  return wsStatus;
}
