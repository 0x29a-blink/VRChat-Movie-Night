import {
  BarChart2,
  Bookmark,
  Clapperboard,
  Download,
  ListVideo,
  Loader2,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Pause,
  Settings as SettingsIcon,
} from "lucide-react";
import { type Dispatch, lazy, type SetStateAction, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import { useAppRealtime } from "./appRealtime";
import { readNavFromLocation, writeNavToLocation, type AppTab, type WatchlistSection } from "./appNav";
import { canControlPlayer } from "./capabilities";
import { Login } from "./components/Login";
import { PlaybackProvider } from "./components/PlaybackContext";
import { SessionStrip } from "./components/SessionStrip";
import { TabSkeleton } from "./components/TabSkeleton";
import { ToastProvider, useToast } from "./components/Toast";
import { stripVisible } from "./stripVisibility";
import { WatchlistAddProvider } from "./watchlistAddModal";
import type { AppEvent, Job, MovieNightSession, PlayerState, PreflightStatus, QueueSnapshot, UserInfo } from "./types";
import { clearStreamLaunchFromLocation, readStreamLaunchFromLocation, type StreamLaunch } from "./streamOpenUrl";
import type { WsStatus } from "./ws";

// Tab-level components are code-split: each becomes its own chunk, loaded on
// first navigation to that tab (see plans/023-shell-code-splitting.md). Only
// Login and the context Providers stay in the eager shell bundle.
const Downloads = lazy(() => import("./components/Downloads").then((m) => ({ default: m.Downloads })));
const Library = lazy(() => import("./components/Library").then((m) => ({ default: m.Library })));
const Watchlist = lazy(() => import("./components/Watchlist").then((m) => ({ default: m.Watchlist })));
const Stats = lazy(() => import("./components/Stats").then((m) => ({ default: m.Stats })));
const Tonight = lazy(() => import("./components/Tonight").then((m) => ({ default: m.Tonight })));
const SettingsPage = lazy(() => import("./components/SettingsPage").then((m) => ({ default: m.SettingsPage })));

type Tab = AppTab;
type ObsState = { connected: boolean; streaming: boolean };

const NAV: { id: Tab; label: string; icon: typeof Download }[] = [
  { id: "tonight", label: "Tonight", icon: Clapperboard },
  { id: "watchlist", label: "Watchlist", icon: Bookmark },
  { id: "library", label: "Library", icon: ListVideo },
  { id: "add", label: "Add Media", icon: Download },
  { id: "stats", label: "Stats", icon: BarChart2 },
  { id: "settings", label: "Settings", icon: SettingsIcon },
];

function AppShell() {
  const { push: pushToast } = useToast();
  const [user, setUser] = useState<UserInfo | null>(null);
  const [authed, setAuthed] = useState<boolean | null>(null);
  const initialNav = readNavFromLocation();
  const [tab, setTab] = useState<Tab>(() =>
    readStreamLaunchFromLocation() ? "add" : initialNav.tab
  );
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem("mn_sidebar") === "collapsed";
    } catch {
      return false;
    }
  });
  const toggleSidebarCollapsed = () =>
    setSidebarCollapsed((v) => {
      const next = !v;
      try {
        window.localStorage.setItem("mn_sidebar", next ? "collapsed" : "open");
      } catch {
        // Best effort — the choice still applies for this session.
      }
      return next;
    });
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
  const [preflight, setPreflight] = useState<PreflightStatus | null>(null);
  const [navOpen, setNavOpen] = useState(false);

  const goToQueue = useCallback(() => setTab("tonight"), []);
  const goToAddMedia = useCallback(() => setTab("add"), []);

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
    navigateTab("add");
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
      .then((s) => setPreflight(s))
      .catch(() =>
        setPreflight((prev) => ({
          api: false,
          obs_connected: false,
          obs_streaming: false,
          mediamtx_running: false,
          hls_stream_active: false,
          hls_reachable: false,
          hls_url: prev?.hls_url ?? "",
          users: prev?.users ?? 0,
          tools: prev?.tools ?? [],
          issues: ["Could not reach the API"],
          checklist_ok: false,
          ready: false,
        }))
      )
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

  const checklistIssues = (preflight?.issues ?? []).length;

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
  const showGoLiveWarning = (playing || paused) && obs.connected && !obs.streaming;
  const showSessionStrip = stripVisible(tab, session, player, activeDownloads);

  const goLive = async () => {
    try {
      await api.obsStreamStart();
      setObs((o) => ({ ...o, streaming: true }));
      pushToast("Stream is live — friends can watch in VRChat", "success");
    } catch (err: unknown) {
      pushToast(err instanceof Error ? err.message : "Could not start stream", "error");
    }
  };

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
          collapsed={sidebarCollapsed}
          onToggleCollapsed={toggleSidebarCollapsed}
          tab={tab}
          activeDownloads={activeDownloads}
          queue={queue}
          checklistIssues={checklistIssues}
          user={user}
          wsStatus={wsStatus}
          libraryScanning={libraryScanning}
          obs={obs}
          onNavigate={navigateTab}
          onLogout={() => api.logout().then(() => { setAuthed(false); setUser(null); })}
        />

        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <MobileHeader tab={tab} onOpenNav={() => setNavOpen(true)} />
          <PlaybackNotice
            paused={paused}
            showGoLiveWarning={showGoLiveWarning}
            canGoLive={!!user && canControlPlayer(user)}
            onGoLive={goLive}
          />

          <div
            className={`flex-1 overflow-y-auto ${
              showSessionStrip
                ? "pb-[calc(5rem+env(safe-area-inset-bottom))] md:pb-[calc(4rem+env(safe-area-inset-bottom))]"
                : ""
            }`}
          >
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
                  onGoToAddMedia={goToAddMedia}
                  onObs={setObs}
                  preflight={preflight}
                  onPreflight={setPreflight}
                  activeDownloads={activeDownloads}
                />
              </Suspense>
            </div>
          </div>
        </main>
      </div>

      <SessionStrip
        tab={tab}
        session={session}
        player={player}
        activeDownloads={activeDownloads}
        user={user}
        onNavigate={navigateTab}
      />
    </PlaybackProvider>
  );
}

function AppSidebar({
  navOpen,
  collapsed,
  onToggleCollapsed,
  tab,
  activeDownloads,
  queue,
  checklistIssues,
  user,
  wsStatus,
  libraryScanning,
  obs,
  onNavigate,
  onLogout,
}: {
  navOpen: boolean;
  /** Desktop-only icon-rail mode; the mobile drawer always renders expanded. */
  collapsed: boolean;
  onToggleCollapsed: () => void;
  tab: Tab;
  activeDownloads: number;
  queue: QueueSnapshot;
  checklistIssues: number;
  user: UserInfo;
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
      } ${collapsed ? "lg:w-[4.5rem] lg:p-2" : "lg:w-64"}`}
    >
      <div className={`mb-6 flex items-center gap-3 px-2 ${collapsed ? "lg:flex-col lg:gap-2 lg:px-0" : ""}`}>
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-500">
          <Clapperboard className="h-5 w-5 text-brand-ink" />
        </div>
        <div className={`min-w-0 flex-1 ${collapsed ? "lg:hidden" : ""}`}>
          <div className="text-sm font-semibold leading-tight">Movie Night</div>
          <div className="text-xs text-slate-400">VRChat Control</div>
        </div>
        <button
          type="button"
          onClick={onToggleCollapsed}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="hidden shrink-0 rounded-lg p-2 text-slate-500 transition-colors hover:bg-white/5 hover:text-slate-200 lg:block"
        >
          {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          <span className="sr-only">{collapsed ? "Expand sidebar" : "Collapse sidebar"}</span>
        </button>
      </div>

      <nav className="flex flex-1 flex-col gap-1">
        {NAV.map((item) => (
          <AppNavButton
            key={item.id}
            item={item}
            active={tab === item.id}
            collapsed={collapsed}
            activeDownloads={activeDownloads}
            queueCount={queue.items.length}
            checklistIssues={checklistIssues}
            onNavigate={onNavigate}
          />
        ))}
      </nav>

      <div className="mt-4 space-y-1">
        <SidebarStatus wsStatus={wsStatus} obs={obs} libraryScanning={libraryScanning} collapsed={collapsed} />
        <div
          className={`flex items-center justify-between gap-2 rounded-xl px-3 py-1 text-xs text-slate-400 ${
            collapsed ? "lg:justify-center lg:px-0" : ""
          }`}
        >
          <span className={`truncate ${collapsed ? "lg:hidden" : ""}`}>@{user.username}</span>
          <button
            onClick={onLogout}
            title="Sign out"
            className="shrink-0 rounded-lg p-2 text-slate-400 transition-colors hover:bg-white/5 hover:text-slate-200"
          >
            <LogOut className="h-4 w-4" />
            <span className="sr-only">Sign out</span>
          </button>
        </div>
      </div>
    </aside>
  );
}

function AppNavButton({
  item,
  active,
  collapsed,
  activeDownloads,
  queueCount,
  checklistIssues,
  onNavigate,
}: {
  item: (typeof NAV)[number];
  active: boolean;
  collapsed: boolean;
  activeDownloads: number;
  queueCount: number;
  checklistIssues: number;
  onNavigate: (next: Tab) => void;
}) {
  const Icon = item.icon;
  const showDownloadsBadge = item.id === "add" && activeDownloads > 0;
  const showQueueBadge = item.id === "tonight" && queueCount > 0;
  const showIssuesDot = item.id === "tonight" && checklistIssues > 0;

  return (
    <button
      onClick={() => onNavigate(item.id)}
      title={collapsed ? item.label : undefined}
      className={`group relative flex items-center justify-between rounded-xl px-3 py-2.5 text-sm transition-colors ${
        active ? "bg-brand-500/15 text-white" : "text-slate-300 hover:bg-white/5"
      } ${collapsed ? "lg:justify-center lg:px-0" : ""}`}
    >
      <span className="flex items-center gap-3">
        <Icon className={`h-[18px] w-[18px] ${active ? "text-brand-400" : "text-slate-400"}`} />
        <span className={collapsed ? "lg:hidden" : ""}>{item.label}</span>
      </span>
      <span className={`flex items-center gap-1.5 ${collapsed ? "lg:hidden" : ""}`}>
        {showDownloadsBadge && <span className="chip bg-brand-500/20 text-brand-300">{activeDownloads}</span>}
        {showQueueBadge && <span className="chip bg-white/10 text-slate-300">{queueCount}</span>}
        {showIssuesDot && (
          <span
            className="h-2 w-2 shrink-0 rounded-full bg-red-500 ring-2 ring-ink-900"
            title={`${checklistIssues} checklist issue${checklistIssues === 1 ? "" : "s"}`}
          />
        )}
      </span>
      {/* Icon-rail mode: badges collapse to a corner dot */}
      {collapsed && (showDownloadsBadge || showIssuesDot) && (
        <span
          className={`absolute right-1.5 top-1.5 hidden h-2 w-2 rounded-full lg:block ${
            showIssuesDot ? "bg-red-500" : "bg-brand-400"
          }`}
        />
      )}
    </button>
  );
}

/**
 * One status line instead of the old stack of four pills: quiet single row
 * when everything is fine, one named row per problem otherwise.
 */
function SidebarStatus({
  wsStatus,
  obs,
  libraryScanning,
  collapsed,
}: {
  wsStatus: WsStatus;
  obs: ObsState;
  libraryScanning: boolean;
  collapsed: boolean;
}) {
  const problems: { key: string; label: string; tone: "amber" | "red"; busy?: boolean }[] = [];
  if (wsStatus !== "connected") {
    problems.push({
      key: "ws",
      label: wsStatus === "connecting" ? "Connecting live updates…" : "Reconnecting live updates…",
      tone: "amber",
      busy: true,
    });
  }
  if (!obs.connected) problems.push({ key: "obs", label: "OBS offline", tone: "red" });
  if (libraryScanning) problems.push({ key: "scan", label: "Scanning library…", tone: "amber", busy: true });

  const allGood = problems.length === 0;
  const summary = allGood
    ? obs.streaming
      ? "All good · stream live"
      : "All systems good"
    : problems.map((p) => p.label).join(" · ");
  const dotClass = problems.some((p) => p.tone === "red")
    ? "bg-red-500"
    : problems.length > 0
      ? "bg-amber-400"
      : "bg-emerald-400";

  if (collapsed) {
    return (
      <>
        {/* Mobile drawer keeps the expanded rows */}
        <div className="lg:hidden">
          <SidebarStatus wsStatus={wsStatus} obs={obs} libraryScanning={libraryScanning} collapsed={false} />
        </div>
        <div className="hidden justify-center py-2 lg:flex" title={summary}>
          <span className={`h-2.5 w-2.5 rounded-full ${dotClass}`} />
        </div>
      </>
    );
  }

  if (allGood) {
    return (
      <div className="flex items-center gap-2 rounded-xl px-3 py-1.5 text-xs text-slate-400" title={summary}>
        <span className={`h-2 w-2 shrink-0 rounded-full ${dotClass}`} />
        {summary}
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {problems.map((p) => (
        <div
          key={p.key}
          className={`flex items-center gap-2 rounded-xl px-3 py-1.5 text-xs ${
            p.tone === "red" ? "bg-red-500/10 text-red-300" : "bg-amber-500/10 text-amber-300"
          }`}
        >
          {p.busy ? (
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
          ) : (
            <span className="h-2 w-2 shrink-0 rounded-full bg-current" />
          )}
          {p.label}
        </div>
      ))}
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
  canGoLive,
  onGoLive,
}: {
  paused: boolean;
  showGoLiveWarning: boolean;
  canGoLive: boolean;
  onGoLive: () => void;
}) {
  if (!paused && !showGoLiveWarning) return null;

  return (
    <div
      className={`shrink-0 border-b px-4 py-1.5 text-sm ${
        paused ? "border-amber-500/20 bg-amber-500/10 text-amber-200" : "border-brand-500/20 bg-brand-500/10 text-brand-200"
      }`}
    >
      {paused ? (
        <span className="flex min-h-8 items-center gap-2">
          <Pause className="h-4 w-4 shrink-0" />
          Intermission — playback is paused. Resume on Tonight when ready.
        </span>
      ) : (
        <span className="flex min-h-8 flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <span>
            Video is playing locally but the stream is not live
            {canGoLive ? "." : " — ask the host to go live so friends see it in VRChat."}
          </span>
          {canGoLive && (
            <button type="button" onClick={onGoLive} className="btn-primary shrink-0 px-3 py-1 text-xs">
              Go live
            </button>
          )}
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
  onGoToAddMedia,
  onObs,
  preflight,
  onPreflight,
  activeDownloads,
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
  onGoToAddMedia: () => void;
  onObs: Dispatch<SetStateAction<ObsState>>;
  preflight: PreflightStatus | null;
  onPreflight: Dispatch<SetStateAction<PreflightStatus | null>>;
  activeDownloads: number;
}) {
  switch (tab) {
    case "tonight":
      return (
        <Tonight
          queue={queue}
          player={player}
          obs={obs}
          onObs={onObs}
          activityEvent={activityEvent}
          user={user}
          session={session}
          onSessionChange={onSessionChange}
          libraryVersion={libVersion + watchlistVersion}
          preflight={preflight}
          onPreflight={onPreflight}
          activeDownloads={activeDownloads}
          onGoToAddMedia={onGoToAddMedia}
        />
      );
    case "add":
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

