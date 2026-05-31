import {
  BarChart2,
  Bookmark,
  Clapperboard,
  ClipboardCheck,
  Download,
  ListVideo,
  Loader2,
  LogOut,
  Pause,
  Settings as SettingsIcon,
  Wifi,
  WifiOff,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import { readNavFromLocation, writeNavToLocation, type AppTab } from "./appNav";
import { Downloads } from "./components/Downloads";
import { Library } from "./components/Library";
import { Login } from "./components/Login";
import { MovieNightChecklist } from "./components/MovieNightChecklist";
import { PlaybackProvider } from "./components/PlaybackContext";
import { QueuePlayer } from "./components/QueuePlayer";
import { SettingsPage } from "./components/SettingsPage";
import { Stats } from "./components/Stats";
import { ToastProvider, useToast } from "./components/Toast";
import { Watchlist } from "./components/Watchlist";
import { fmtMs } from "./format";
import type { Job, PlayerState, QueueSnapshot, UserInfo } from "./types";
import { clearStreamLaunchFromLocation, readStreamLaunchFromLocation, type StreamLaunch } from "./streamOpenUrl";
import { useWebSocket, type WsStatus } from "./ws";

type Tab = AppTab;

const NAV: { id: Tab; label: string; icon: typeof Download }[] = [
  { id: "downloads", label: "Get Videos", icon: Download },
  { id: "library", label: "Library", icon: ListVideo },
  { id: "watchlist", label: "Watchlist", icon: Bookmark },
  { id: "stats", label: "Stats", icon: BarChart2 },
  { id: "queue", label: "Queue & Player", icon: Clapperboard },
  { id: "checklist", label: "Movie Night", icon: ClipboardCheck },
  { id: "settings", label: "Settings", icon: SettingsIcon },
];

function AppShell() {
  const { push: pushToast } = useToast();
  const [user, setUser] = useState<UserInfo | null>(null);
  const [authed, setAuthed] = useState<boolean | null>(null);
  const initialNav = readNavFromLocation();
  const [tab, setTab] = useState<Tab>(() =>
    readStreamLaunchFromLocation() ? "downloads" : initialNav.tab
  );
  const [watchlistGroupId, setWatchlistGroupId] = useState<number | undefined>(initialNav.watchlistGroupId);

  const [jobs, setJobs] = useState<Job[]>([]);
  const [queue, setQueue] = useState<QueueSnapshot>({ items: [], current_index: -1, current: null });
  const [player, setPlayer] = useState<PlayerState | null>(null);
  const [libVersion, setLibVersion] = useState(0);
  const [watchlistVersion, setWatchlistVersion] = useState(0);
  const [obs, setObs] = useState<{ connected: boolean; streaming: boolean }>({
    connected: false,
    streaming: false,
  });
  const jobStatusRef = useRef<Record<string, string>>({});
  const linkedToastRef = useRef<{ title: string; timer: number } | null>(null);
  const [pendingStreamLaunch, setPendingStreamLaunch] = useState<StreamLaunch | null>(() =>
    readStreamLaunchFromLocation()
  );
  const [checklistIssues, setChecklistIssues] = useState(0);

  const goToQueue = useCallback(() => setTab("queue"), []);

  const navigateTab = useCallback(
    (next: Tab, groupId?: number) => {
      setTab(next);
      const gid = next === "watchlist" ? (groupId ?? watchlistGroupId) : undefined;
      if (groupId != null) setWatchlistGroupId(groupId);
      writeNavToLocation({ tab: next, watchlistGroupId: gid });
    },
    [watchlistGroupId]
  );

  const refreshMe = useCallback(() => {
    api
      .me()
      .then((r) => {
        setAuthed(r.authenticated);
        setUser(r.user);
      })
      .catch(() => {
        setAuthed(false);
        setUser(null);
      });
  }, []);

  useEffect(() => {
    refreshMe();
  }, [refreshMe]);

  const refreshAll = useCallback(() => {
    api.listDownloads().then(setJobs).catch(() => {});
    api.queue().then(setQueue).catch(() => {});
    api.obsStatus().then(setObs).catch(() => {});
    api.playerStatus().then(setPlayer).catch(() => {});
  }, []);

  useEffect(() => {
    if (authed) refreshAll();
  }, [authed, refreshAll]);

  useEffect(() => {
    if (authed !== true) return;
    const fromUrl = readStreamLaunchFromLocation();
    const launch = pendingStreamLaunch ?? fromUrl;
    if (!launch) return;
    if (fromUrl) clearStreamLaunchFromLocation();
    navigateTab("downloads");
    if (!pendingStreamLaunch) setPendingStreamLaunch(launch);
  }, [authed, pendingStreamLaunch, navigateTab]);

  useEffect(() => {
    if (!authed) return;
    const t = setInterval(() => api.obsStatus().then(setObs).catch(() => {}), 5000);
    return () => clearInterval(t);
  }, [authed]);

  const refreshChecklistIssues = useCallback(() => {
    api
      .preflight()
      .then((s) => setChecklistIssues((s.issues ?? []).length))
      .catch(() => setChecklistIssues(1));
  }, []);

  useEffect(() => {
    if (!authed) return;
    refreshChecklistIssues();
    const t = setInterval(refreshChecklistIssues, 30000);
    return () => clearInterval(t);
  }, [authed, refreshChecklistIssues]);

  const wsStatus = useWebSocket(authed === true, (event, data) => {
    if (event === "download_update") {
      const prevStatus = jobStatusRef.current[data.id];
      jobStatusRef.current[data.id] = data.status;
      if (data.status === "completed" && prevStatus && prevStatus !== "completed") {
        if (data.link_tmdb_id) {
          if (linkedToastRef.current) window.clearTimeout(linkedToastRef.current.timer);
          linkedToastRef.current = {
            title: data.title,
            timer: window.setTimeout(() => {
              pushToast(`Download complete: ${data.title}`, "success");
              linkedToastRef.current = null;
            }, 2500),
          };
        } else {
          pushToast(`Download complete: ${data.title}`, "success");
        }
        setLibVersion((v) => v + 1);
        setWatchlistVersion((v) => v + 1);
      } else if (data.status === "failed" && prevStatus && prevStatus !== "failed") {
        pushToast(`Download failed: ${data.title}`, "error");
      }
      setJobs((prev) => {
        const idx = prev.findIndex((j) => j.id === data.id);
        if (idx === -1) return [data, ...prev];
        const copy = [...prev];
        copy[idx] = data;
        return copy;
      });
    } else if (event === "download_removed") {
      delete jobStatusRef.current[data.id];
      setJobs((prev) => prev.filter((j) => j.id !== data.id));
    } else if (event === "queue_update") {
      setQueue(data);
    } else if (event === "player_update") {
      setPlayer(data);
      if (data?.current_index !== undefined)
        setQueue((q) => ({ ...q, current_index: data.current_index, current: data.current }));
    } else if (event === "library_update") {
      setLibVersion((v) => v + 1);
      setWatchlistVersion((v) => v + 1);
      if (data?.reason === "download_linked" && data?.title) {
        if (linkedToastRef.current) {
          window.clearTimeout(linkedToastRef.current.timer);
          linkedToastRef.current = null;
          pushToast(`Download complete & linked: ${data.title}`, "success");
        } else {
          pushToast(`Linked to library: ${data.title}`, "success");
        }
      }
    }
  });

  if (authed === null) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-brand-400" />
      </div>
    );
  }

  if (!authed || !user) {
    return (
      <Login
        onSuccess={() => {
          refreshMe();
        }}
      />
    );
  }

  const activeDownloads = jobs.filter(
    (j) => j.status === "downloading" || j.status === "queued" || j.status === "caching"
  ).length;

  const playing = player?.media_state === "OBS_MEDIA_STATE_PLAYING";
  const paused = player?.media_state === "OBS_MEDIA_STATE_PAUSED" && !!queue.current;
  const nowTitle = queue.current?.title;
  const nowCursor = player?.cursor ?? 0;
  const showGoLiveWarning = (playing || paused) && obs.connected && !obs.streaming;

  return (
    <PlaybackProvider obs={obs} onGoToQueue={goToQueue}>
      <div className="flex h-full">
        <aside className="flex w-64 shrink-0 flex-col border-r border-white/5 bg-ink-900/60 p-4">
          <div className="mb-8 flex items-center gap-3 px-2">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-accent-500 shadow-glow">
              <Clapperboard className="h-5 w-5 text-white" />
            </div>
            <div>
              <div className="text-sm font-semibold leading-tight">Movie Night</div>
              <div className="text-xs text-slate-400">VRChat Control</div>
            </div>
          </div>

          <nav className="flex flex-1 flex-col gap-1">
            {NAV.map((n) => {
              const Icon = n.icon;
              const active = tab === n.id;
              return (
                <button
                  key={n.id}
                  onClick={() => navigateTab(n.id)}
                  className={`group flex items-center justify-between rounded-xl px-3 py-2.5 text-sm transition-colors ${
                    active ? "bg-brand-500/15 text-white" : "text-slate-300 hover:bg-white/5"
                  }`}
                >
                  <span className="flex items-center gap-3">
                    <Icon className={`h-[18px] w-[18px] ${active ? "text-brand-400" : "text-slate-400"}`} />
                    {n.label}
                  </span>
                  {n.id === "downloads" && activeDownloads > 0 && (
                    <span className="chip bg-brand-500/20 text-brand-300">{activeDownloads}</span>
                  )}
                  {n.id === "queue" && queue.items.length > 0 && (
                    <span className="chip bg-white/10 text-slate-300">{queue.items.length}</span>
                  )}
                  {n.id === "checklist" && checklistIssues > 0 && (
                    <span
                      className="h-2 w-2 shrink-0 rounded-full bg-red-500 ring-2 ring-ink-900"
                      title={`${checklistIssues} checklist issue${checklistIssues === 1 ? "" : "s"}`}
                    />
                  )}
                </button>
              );
            })}
          </nav>

          <div className="mt-4 space-y-2">
            {nowTitle && (
              <div className="rounded-xl bg-white/[0.03] px-3 py-2 text-xs">
                <div className="text-[10px] uppercase tracking-wide text-slate-500">
                  {playing ? "Now playing" : paused ? "Paused" : "Queue"}
                </div>
                <div className="mt-0.5 truncate font-medium text-slate-200" title={nowTitle}>
                  {nowTitle}
                </div>
                {(playing || paused) && (
                  <div className="mt-0.5 tabular-nums text-slate-500">{fmtMs(nowCursor)}</div>
                )}
              </div>
            )}
            <div className="rounded-xl px-3 py-2 text-xs text-slate-400">@{user.username}</div>
            <WsStatusBadge status={wsStatus} />
            <div
              className={`flex items-center gap-2 rounded-xl px-3 py-2 text-xs ${
                obs.connected ? "bg-emerald-500/10 text-emerald-300" : "bg-red-500/10 text-red-300"
              }`}
            >
              {obs.connected ? <Wifi className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}
              <span>
                OBS {obs.connected ? "connected" : "offline"}
                {obs.connected && (obs.streaming ? " · live" : " · idle")}
              </span>
            </div>
            <button
              onClick={() => api.logout().then(() => { setAuthed(false); setUser(null); })}
              className="btn-ghost w-full justify-start text-slate-400"
            >
              <LogOut className="h-4 w-4" /> Sign out
            </button>
          </div>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {(paused || showGoLiveWarning) && (
            <div
              className={`shrink-0 border-b px-4 py-2.5 text-sm ${
                paused
                  ? "border-amber-500/20 bg-amber-500/10 text-amber-200"
                  : "border-brand-500/20 bg-brand-500/10 text-brand-200"
              }`}
            >
              {paused ? (
                <span className="flex items-center gap-2">
                  <Pause className="h-4 w-4 shrink-0" />
                  Intermission — playback is paused. Resume on Queue &amp; Player when ready.
                </span>
              ) : (
                <span>
                  Video is playing locally but the stream is not live — click <strong>Go live</strong> on Queue
                  &amp; Player so friends see it in VRChat.
                </span>
              )}
            </div>
          )}

          <div className="flex-1 overflow-y-auto">
            <div className="mx-auto max-w-6xl p-4 sm:p-6 lg:p-8">
              {tab === "downloads" && (
                <Downloads
                  jobs={jobs}
                  onChanged={refreshAll}
                  onJobRemoved={(id) => setJobs((prev) => prev.filter((j) => j.id !== id))}
                  initialStreamLaunch={pendingStreamLaunch}
                  onInitialStreamOpenHandled={() => setPendingStreamLaunch(null)}
                />
              )}
              {tab === "library" && <Library version={libVersion} />}
              {tab === "watchlist" && (
                <Watchlist
                  user={user}
                  refreshVersion={watchlistVersion}
                  initialGroupId={watchlistGroupId}
                  onGroupChange={(gid) => {
                    setWatchlistGroupId(gid);
                    writeNavToLocation({ tab: "watchlist", watchlistGroupId: gid });
                  }}
                  onGoToQueue={goToQueue}
                />
              )}
              {tab === "stats" && <Stats />}
              {tab === "queue" && (
                <QueuePlayer queue={queue} player={player} obs={obs} onObs={setObs} />
              )}
              {tab === "checklist" && (
                <MovieNightChecklist onIssuesChange={setChecklistIssues} />
              )}
              {tab === "settings" && <SettingsPage user={user} />}
            </div>
          </div>
        </main>
      </div>
    </PlaybackProvider>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <AppShell />
    </ToastProvider>
  );
}

function WsStatusBadge({ status }: { status: WsStatus }) {
  if (status === "connected") {
    return (
      <div className="flex items-center gap-2 rounded-xl bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
        <span className="h-2 w-2 rounded-full bg-emerald-400" />
        Live updates connected
      </div>
    );
  }
  if (status === "connecting") {
    return (
      <div className="flex items-center gap-2 rounded-xl bg-white/5 px-3 py-2 text-xs text-slate-400">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Connecting…
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 rounded-xl bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
      <Loader2 className="h-3.5 w-3.5 animate-spin" />
      Reconnecting live updates…
    </div>
  );
}
