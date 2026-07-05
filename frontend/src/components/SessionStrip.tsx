import { Download, Loader2, Pause, Play, SkipForward } from "lucide-react";
import { api } from "../api";
import type { AppTab } from "../appNav";
import { canControlPlayer } from "../capabilities";
import { sessionStageLabel, stripStateLabel, stripTitle, stripVisible } from "../stripVisibility";
import type { MovieNightSession, PlayerState, UserInfo } from "../types";
import { useToast } from "./Toast";

/**
 * Persistent bottom strip shown on every non-Tonight tab whenever a session
 * is active, media is playing/paused, or downloads are in progress (plan
 * 025). Deliberately dumb: it renders App's existing state and calls two
 * transport endpoints. New affordances go to Tonight first.
 */
export function SessionStrip({
  tab,
  session,
  player,
  activeDownloads,
  user,
  onNavigate,
}: {
  tab: AppTab;
  session: MovieNightSession | null;
  player: PlayerState | null;
  activeDownloads: number;
  user: UserInfo;
  onNavigate: (tab: AppTab) => void;
}) {
  const { push: pushToast } = useToast();

  if (!stripVisible(tab, session, player, activeDownloads)) return null;

  const canControl = canControlPlayer(user);
  const title = stripTitle(player, session);
  const stateLabel = stripStateLabel(player);
  const stageLabel = sessionStageLabel(session);
  const playing = player?.media_state === "OBS_MEDIA_STATE_PLAYING";
  const hasCurrent = !!player?.current;
  const duration = player?.duration ?? 0;
  const cursor = player?.cursor ?? 0;
  const pct = duration > 0 ? Math.min(100, Math.max(0, (cursor / duration) * 100)) : 0;

  const runTransport = (label: string, fn: () => Promise<unknown>) => (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!canControl) return;
    fn().catch((err: unknown) => {
      pushToast(err instanceof Error ? err.message : `${label} failed`, "error");
    });
  };

  return (
    <div className="fixed bottom-0 inset-x-0 z-40 pb-[env(safe-area-inset-bottom)]">
      <div className="relative flex h-16 w-full items-center gap-3 border-t border-white/10 bg-ink-900/95 px-3 backdrop-blur md:h-14">
        {duration > 0 && (
          <div className="absolute inset-x-0 bottom-0 h-0.5 bg-white/5">
            <div className="h-full bg-gradient-to-r from-brand-500 to-accent-500" style={{ width: `${pct}%` }} />
          </div>
        )}

        <button
          type="button"
          onClick={() => onNavigate("tonight")}
          aria-label="Go to Tonight"
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-slate-100" title={title}>
              {title}
            </div>
            <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
              <span>{stateLabel}</span>
              {stageLabel && (
                <span className="chip bg-white/10 text-slate-300">{stageLabel}</span>
              )}
            </div>
          </div>
        </button>

        {canControl && (
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={runTransport(playing ? "Pause" : "Play", () => (hasCurrent ? api.toggle() : api.play()))}
              aria-label={playing ? "Pause" : "Play"}
              title={playing ? "Pause" : "Play"}
              className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20"
            >
              {playing ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5 translate-x-0.5" />}
            </button>
            <button
              type="button"
              onClick={runTransport("Next", () => api.next())}
              aria-label="Next"
              title="Next"
              className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white/5 text-slate-200 hover:bg-white/10"
            >
              <SkipForward className="h-5 w-5" />
            </button>
          </div>
        )}

        {activeDownloads > 0 && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onNavigate("add");
            }}
            className="chip min-h-11 shrink-0 gap-1.5 px-3 bg-brand-500/20 text-brand-300"
            aria-label={`${activeDownloads} active download${activeDownloads === 1 ? "" : "s"}`}
            title="Go to Add Media"
          >
            <Loader2 className="h-3 w-3 animate-spin" />
            {activeDownloads}
            <Download className="h-3 w-3" />
          </button>
        )}
      </div>
    </div>
  );
}
