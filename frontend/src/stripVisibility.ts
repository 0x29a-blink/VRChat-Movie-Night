import type { MovieNightSession, PlayerState } from "./types";
import type { AppTab } from "./appNav";

/**
 * Pure visibility/title logic for the persistent SessionStrip (plan 025).
 * Extracted so it's unit-testable without mounting the component (the
 * vitest harness has no jsdom-free component testing — pure helpers are
 * the testable surface, see plans/025-session-strip.md).
 */

/** media_state values that mean "something is actively happening" —
 * anything else (empty string, undefined, NONE, ENDED) counts as stopped/idle. */
const ACTIVE_MEDIA_STATES = new Set([
  "OBS_MEDIA_STATE_PLAYING",
  "OBS_MEDIA_STATE_PAUSED",
  "OBS_MEDIA_STATE_OPENING",
  "OBS_MEDIA_STATE_BUFFERING",
]);

function isPlayerActive(player: PlayerState | null): boolean {
  if (!player) return false;
  return ACTIVE_MEDIA_STATES.has(player.media_state);
}

/**
 * Whether the SessionStrip should render.
 * Hidden when: current tab is "tonight" (the strip's tap-through target is
 * itself), OR nothing is going on: no active session, player is empty/
 * stopped, and there are no active downloads.
 */
export function stripVisible(
  tab: AppTab,
  session: MovieNightSession | null,
  player: PlayerState | null,
  activeDownloads: number
): boolean {
  if (tab === "tonight") return false;
  if (session != null) return true;
  if (isPlayerActive(player)) return true;
  if (activeDownloads > 0) return true;
  return false;
}

/** Human label for a session's current stage, or undefined if no session. */
export function sessionStageLabel(session: MovieNightSession | null): string | undefined {
  if (!session) return undefined;
  switch (session.state) {
    case "picking":
      return "Picking";
    case "queued":
      return "Queued";
    case "playing":
      return "Playing";
    case "rating":
      return "Rating";
    case "ended":
      return undefined;
    default:
      return undefined;
  }
}

/** Tiny playback-state label for the now-playing chip. */
export function stripStateLabel(player: PlayerState | null): string {
  switch (player?.media_state) {
    case "OBS_MEDIA_STATE_PLAYING":
      return "Playing";
    case "OBS_MEDIA_STATE_PAUSED":
      return "Paused";
    case "OBS_MEDIA_STATE_ENDED":
      return "Ended";
    default:
      return "Idle";
  }
}

/**
 * Now-playing title: prefer the live player's current item, fall back to
 * the active session's pick (watchlist or library title), else an em-dash.
 */
export function stripTitle(player: PlayerState | null, session: MovieNightSession | null): string {
  const playerTitle = player?.current?.title;
  if (playerTitle) return playerTitle;
  const sessionTitle = session?.watchlist_item_title || session?.library_item_title;
  if (sessionTitle) return sessionTitle;
  return "—";
}
