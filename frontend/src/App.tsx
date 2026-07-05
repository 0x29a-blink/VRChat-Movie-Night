import {
  BarChart2,
  Bookmark,
  Clapperboard,
  ClipboardCheck,
  Download,
  ListVideo,
  Loader2,
  LogOut,
  Menu,
  Pause,
  Settings as SettingsIcon,
  Wifi,
  WifiOff,
} from "lucide-react";
import { type Dispatch, lazy, type SetStateAction, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import { useAppRealtime } from "./appRealtime";
import { readNavFromLocation, writeNavToLocation, type AppTab, type WatchlistSection } from "./appNav";
import { Login } from "./components/Login";
import { PlaybackProvider } from "./components/PlaybackContext";
import { TabSkeleton } from "./components/TabSkeleton";
import { ToastProvider, useToast } from "./components/Toast";
import { WatchlistAddProvider } from "./watchlistAddModal";
import { fmtMs } from "./format";
import type { AppEvent, Job, MovieNightSession, PlayerState, QueueSnapshot, UserInfo } from "./types";
import { clearStreamLaunchFromLocation, readStreamLaunchFromLocation, type StreamLaunch } from "./streamOpenUrl";
import type { WsStatus } from "./ws";

// Tab-level components are code-split: each becomes its own chunk, loaded on
// first navigation to that tab (see plans/023-shell-code-splitting.md). Only
// Login and the context Providers stay in the eager shell bundle.
const Downloads = lazy(() => import("./components/Downloads").then((m) => ({ default: m.Downloads })));
const Library = lazy(() => import("./components/Library").then((m) => ({ default: m.Library })));
const Watchlist = lazy(() => import("./components/Watchlist").then((m) => ({ default: m.Watchlist })));
const Stats = lazy(() => import("./components/Stats").then((m) => ({ default: m.Stats })));
const QueuePlayer = lazy(() => import("./components/QueuePlayer").then((m) => ({ default: m.QueuePlayer })));
const MovieNightChecklist = lazy(() =>
  import("./components/MovieNightChecklist").then((m) => ({ default: m.MovieNightChecklist }))
);
const SettingsPage = lazy(() => import("./components/SettingsPage").then((m) => ({ default: m.SettingsPage })));

type Tab = AppTab;
type ObsState = { connected: boolean; streaming: boolean };

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
  const [watchlistSection, setWatchlistSection] = useState<WatchlistSection>(
    initialNav.watchlistSection ?? "to_watch"
  );

  const [jobs, setJobs] = useState<Job[]>([]);
  const [queue, setQueue] = useState<QueueSnapshot>({ items: [], current_index: -1, current: null });
  const [player, setPlayer] = useState<PlayerState | null>(null);
  const [activityEvent, setActivityEvent] = useState<AppEvent | null>(null);
  const [session, setSession] = useState<MovieNightSession | null>(null);
  const [libVersion, setLibVersion] = useState(0);
  const [watchlistVersion, setWatchlistVersion] = useState(0);
  const [libraryScanning, setLibraryScanning] = useState(false);
  const [obs, setObs] = useState<ObsState>({
    connected: false,
    streaming: false,
  });
  const [pendingStreamLaunch, setPendingStreamLaunch] = useState<StreamLaunch | null>(() =>
    readStreamLaunchFromLocation()
  );
  const [checklistIssues, setChecklistIssues] = useState(0);
  const [navOpen, setNavOpen] = useState(false);

  const goToQueue = useCallback(() => setTab("queue"), []);

  const navigateTab = useCallback(
    (next: Tab, groupId?: number) => {
      setTab(next);
      setNavOpen(false);
      const gid = next === "watchlist" ? (groupId ?? watchlistGroupId) : undefined;
      if (groupId != null) setWatchlistGroupId(groupId);
      writeNavToLocation({
        tab: next,
        watchlistGroupId: gid,
        watchlistSection: next === "watchlist" ? watchlistSection : undefined,
      });
    },
    [watchlistGroupId, watchlistSection]
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
    api.sessionCurrent().then((r) => setSession(r.active)).catch(() => {});
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

  const checklistBusyRef = useRef(false);

  const refreshChecklistIssues = useCallback(() => {
    if (document.hidden || checklistBusyRef.current) return;
    checklistBusyRef.current = true;
    api
      .preflight()
      .then((s) => setChecklistIssues((s.issues ?? []).length))
      .catch(() => setChecklistIssues(1))
      .finally(() => {
        checklistBusyRef.current = false;
      });
  }, []);

  useEffect(() => {
    if (!authed) return;
    refreshChecklistIssues();
    const t = setInterval(refreshChecklistIssues, 30000);
    return () => clearInterval(t);
  }, [authed, refreshChecklistIssues]);

  const wsStatus = useAppRealtime({
    authed: authed === true,
    pushToast,
    refreshAll,
    refreshChecklistIssues,
    setJobs,
    setQueue,
    setPlayer,
    setLibVersion,
    setWatchlistVersion,
    setLibraryScanning,
    onActivityEvent: setActivityEvent,
    onSessionUpdate: (s) => setSession(s.state === "ended" ? null : s),
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
      <div className={`flex h-full ${navOpen ? "overflow-hidden lg:overflow-visible" : ""}`}>
        {navOpen && (
          <button
            type="button"
            aria-label="Close menu"
            className="fixed inset-0 z-30 bg-black/60 lg:hidden"
            onClick={() => setNavOpen(false)}
          />
        )}

        <AppSidebar
          navOpen={navOpen}
          tab={tab}
          activeDownloads={activeDownloads}
          queue={queue}
          checklistIssues={checklistIssues}
          user={user}
          nowTitle={nowTitle}
          nowCursor={nowCursor}
          playing={playing}
          paused={paused}
          wsStatus={wsStatus}
          libraryScanning={libraryScanning}
          obs={obs}
          onNavigate={navigateTab}
          onLogout={() => api.logout().then(() => { setAuthed(false); setUser(null); })}
        />

        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <MobileHeader tab={tab} onOpenNav={() => setNavOpen(true)} />
          <PlaybackNotice paused={paused} showGoLiveWarning={showGoLiveWarning} />

          <div className="flex-1 overflow-y-auto">
            <div className="mx-auto max-w-6xl p-4 sm:p-6 lg:p-8">
              <Suspense fallback={<TabSkeleton tab={tab} />}>
                <MainPanels
                  tab={tab}
                  user={user}
                  jobs={jobs}
                  queue={queue}
                  player={player}
                  obs={obs}
                  activityEvent={activityEvent}
                  session={session}
                  onSessionChange={setSession}
                  libVersion={libVersion}
                  watchlistVersion={watchlistVersion}
                  watchlistGroupId={watchlistGroupId}
                  watchlistSection={watchlistSection}
                  pendingStreamLaunch={pendingStreamLaunch}
                  onChanged={refreshAll}
                  onJobRemoved={(id) => setJobs((prev) => prev.filter((j) => j.id !== id))}
                  onInitialStreamOpenHandled={() => setPendingStreamLaunch(null)}
                  onWatchlistGroupChange={(gid) => {
                    setWatchlistGroupId(gid);
                    writeNavToLocation({ tab: "watchlist", watchlistGroupId: gid, watchlistSection });
                  }}
                  onWatchlistSectionChange={(section) => {
                    setWatchlistSection(section);
                    writeNavToLocation({ tab: "watchlist", watchlistGroupId, watchlistSection: section });
                  }}
                  onGoToQueue={goToQueue}
                  onObs={setObs}
                  onChecklistIssuesChange={setChecklistIssues}
                />
              </Suspense>
            </div>
          </div>
        </main>
      </div>
    </PlaybackProvider>
  );
}

function AppSidebar({
  navOpen,
  tab,
  activeDownloads,
  queue,
  checklistIssues,
  user,
  nowTitle,
  nowCursor,
  playing,
  paused,
  wsStatus,
  libraryScanning,
  obs,
  onNavigate,
  onLogout,
}: {
  navOpen: boolean;
  tab: Tab;
  activeDownloads: number;
  queue: QueueSnapshot;
  checklistIssues: number;
  user: UserInfo;
  nowTitle?: string;
  nowCursor: number;
  playing: boolean;
  paused: boolean;
  wsStatus: WsStatus;
  libraryScanning: boolean;
  obs: ObsState;
  onNavigate: (next: Tab) => void;
  onLogout: () => void;
}) {
  return (
    <aside
      className={`fixed inset-y-0 left-0 z-40 flex w-64 shrink-0 flex-col border-r border-white/5 bg-ink-900/95 p-4 backdrop-blur transition-transform duration-200 lg:static lg:z-auto lg:translate-x-0 lg:bg-ink-900/60 ${
        navOpen ? "translate-x-0" : "-translate-x-full"
      }`}
    >
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
        {NAV.map((item) => (
          <AppNavButton
            key={item.id}
            item={item}
            active={tab === item.id}
            activeDownloads={activeDownloads}
            queueCount={queue.items.length}
            checklistIssues={checklistIssues}
            onNavigate={onNavigate}
          />
        ))}
      </nav>

      <div className="mt-4 space-y-2">
        {nowTitle && (
          <NowPlayingCard
            title={nowTitle}
            cursor={nowCursor}
            playing={playing}
            paused={paused}
          />
        )}
        <div className="rounded-xl px-3 py-2 text-xs text-slate-400">@{user.username}</div>
        <WsStatusBadge status={wsStatus} />
        {libraryScanning && <ScanningChip />}
        <ObsStatusBadge obs={obs} />
        <button onClick={onLogout} className="btn-ghost w-full justify-start text-slate-400">
          <LogOut className="h-4 w-4" /> Sign out
        </button>
      </div>
    </aside>
  );
}

function AppNavButton({
  item,
  active,
  activeDownloads,
  queueCount,
  checklistIssues,
  onNavigate,
}: {
  item: (typeof NAV)[number];
  active: boolean;
  activeDownloads: number;
  queueCount: number;
  checklistIssues: number;
  onNavigate: (next: Tab) => void;
}) {
  const Icon = item.icon;

  return (
    <button
      onClick={() => onNavigate(item.id)}
      className={`group flex items-center justify-between rounded-xl px-3 py-2.5 text-sm transition-colors ${
        active ? "bg-brand-500/15 text-white" : "text-slate-300 hover:bg-white/5"
      }`}
    >
      <span className="flex items-center gap-3">
        <Icon className={`h-[18px] w-[18px] ${active ? "text-brand-400" : "text-slate-400"}`} />
        {item.label}
      </span>
      {item.id === "downloads" && activeDownloads > 0 && (
        <span className="chip bg-brand-500/20 text-brand-300">{activeDownloads}</span>
      )}
      {item.id === "queue" && queueCount > 0 && (
        <span className="chip bg-white/10 text-slate-300">{queueCount}</span>
      )}
      {item.id === "checklist" && checklistIssues > 0 && (
        <span
          className="h-2 w-2 shrink-0 rounded-full bg-red-500 ring-2 ring-ink-900"
          title={`${checklistIssues} checklist issue${checklistIssues === 1 ? "" : "s"}`}
        />
      )}
    </button>
  );
}

function NowPlayingCard({
  title,
  cursor,
  playing,
  paused,
}: {
  title: string;
  cursor: number;
  playing: boolean;
  paused: boolean;
}) {
  return (
    <div className="rounded-xl bg-white/[0.03] px-3 py-2 text-xs">
      <div className="text-[10px] uppercase tracking-wide text-slate-500">
        {playing ? "Now playing" : paused ? "Paused" : "Queue"}
      </div>
      <div className="mt-0.5 truncate font-medium text-slate-200" title={title}>
        {title}
      </div>
      {(playing || paused) && <div className="mt-0.5 tabular-nums text-slate-500">{fmtMs(cursor)}</div>}
    </div>
  );
}

function ObsStatusBadge({ obs }: { obs: ObsState }) {
  return (
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
  );
}

function MobileHeader({ tab, onOpenNav }: { tab: Tab; onOpenNav: () => void }) {
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-white/5 px-4 py-2 lg:hidden">
      <button type="button" onClick={onOpenNav} className="btn-ghost !px-2 !py-2" aria-label="Open menu">
        <Menu className="h-5 w-5" />
      </button>
      <span className="truncate text-sm font-medium text-slate-200">
        {NAV.find((n) => n.id === tab)?.label ?? "Movie Night"}
      </span>
    </div>
  );
}

function PlaybackNotice({
  paused,
  showGoLiveWarning,
}: {
  paused: boolean;
  showGoLiveWarning: boolean;
}) {
  if (!paused && !showGoLiveWarning) return null;

  return (
    <div
      className={`shrink-0 border-b px-4 py-2.5 text-sm ${
        paused ? "border-amber-500/20 bg-amber-500/10 text-amber-200" : "border-brand-500/20 bg-brand-500/10 text-brand-200"
      }`}
    >
      {paused ? (
        <span className="flex items-center gap-2">
          <Pause className="h-4 w-4 shrink-0" />
          Intermission — playback is paused. Resume on Queue &amp; Player when ready.
        </span>
      ) : (
        <span>
          Video is playing locally but the stream is not live — click <strong>Go live</strong> on Queue &amp; Player
          so friends see it in VRChat.
        </span>
      )}
    </div>
  );
}

function MainPanels({
  tab,
  user,
  jobs,
  queue,
  player,
  obs,
  activityEvent,
  session,
  onSessionChange,
  libVersion,
  watchlistVersion,
  watchlistGroupId,
  watchlistSection,
  pendingStreamLaunch,
  onChanged,
  onJobRemoved,
  onInitialStreamOpenHandled,
  onWatchlistGroupChange,
  onWatchlistSectionChange,
  onGoToQueue,
  onObs,
  onChecklistIssuesChange,
}: {
  tab: Tab;
  user: UserInfo;
  jobs: Job[];
  queue: QueueSnapshot;
  player: PlayerState | null;
  obs: ObsState;
  activityEvent?: AppEvent | null;
  session: MovieNightSession | null;
  onSessionChange: Dispatch<SetStateAction<MovieNightSession | null>>;
  libVersion: number;
  watchlistVersion: number;
  watchlistGroupId?: number;
  watchlistSection: WatchlistSection;
  pendingStreamLaunch: StreamLaunch | null;
  onChanged: () => void;
  onJobRemoved: (id: string) => void;
  onInitialStreamOpenHandled: () => void;
  onWatchlistGroupChange: (id?: number) => void;
  onWatchlistSectionChange: (section: WatchlistSection) => void;
  onGoToQueue: () => void;
  onObs: Dispatch<SetStateAction<ObsState>>;
  onChecklistIssuesChange: Dispatch<SetStateAction<number>>;
}) {
  switch (tab) {
    case "downloads":
      return (
        <Downloads
          user={user}
          jobs={jobs}
          onChanged={onChanged}
          onJobRemoved={onJobRemoved}
          initialStreamLaunch={pendingStreamLaunch}
          onInitialStreamOpenHandled={onInitialStreamOpenHandled}
        />
      );
    case "library":
      return <Library version={libVersion} user={user} />;
    case "watchlist":
      return (
        <Watchlist
          user={user}
          refreshVersion={watchlistVersion}
          initialGroupId={watchlistGroupId}
          section={watchlistSection}
          onGroupChange={onWatchlistGroupChange}
          onSectionChange={onWatchlistSectionChange}
          onGoToQueue={onGoToQueue}
        />
      );
    case "stats":
      return <Stats />;
    case "queue":
      return (
        <QueuePlayer
          queue={queue}
          player={player}
          obs={obs}
          onObs={onObs}
          activityEvent={activityEvent}
          user={user}
          session={session}
          onSessionChange={onSessionChange}
          libraryVersion={libVersion + watchlistVersion}
        />
      );
    case "checklist":
      return <MovieNightChecklist onIssuesChange={onChecklistIssuesChange} />;
    case "settings":
      return <SettingsPage user={user} />;
  }
}

export default function App() {
  return (
    <ToastProvider>
      <WatchlistAddProvider>
        <AppShell />
      </WatchlistAddProvider>
    </ToastProvider>
  );
}

function ScanningChip() {
  return (
    <div className="flex items-center gap-2 rounded-xl bg-brand-500/10 px-3 py-2 text-xs text-brand-300">
      <span className="h-2 w-2 animate-pulse rounded-full bg-brand-400" />
      Scanning library…
    </div>
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
