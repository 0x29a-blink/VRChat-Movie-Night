import { describe, expect, it } from "vitest";
import { sessionStageLabel, stripStateLabel, stripTitle, stripVisible } from "../stripVisibility";
import type { MovieNightSession, PlayerState, QueueItem } from "../types";

function makeQueueItem(overrides: Partial<QueueItem> = {}): QueueItem {
  return {
    id: 1,
    library_path: "/media/movie.mp4",
    title: "Some Movie",
    thumbnail: "",
    duration: 100000,
    position: 0,
    ...overrides,
  };
}

function makePlayer(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    media_state: "",
    duration: 0,
    cursor: 0,
    current: null,
    current_index: -1,
    ...overrides,
  };
}

function makeSession(overrides: Partial<MovieNightSession> = {}): MovieNightSession {
  return {
    id: 1,
    group_id: null,
    watchlist_item_id: null,
    library_item_id: null,
    state: "picking",
    started_by_user_id: null,
    created_at: null,
    ended_at: null,
    ...overrides,
  };
}

describe("stripVisible", () => {
  it("hides on the tonight tab even when a session is active", () => {
    expect(stripVisible("tonight", makeSession(), makePlayer(), 3)).toBe(false);
  });

  it("hides when fully idle: no session, empty player, no downloads", () => {
    expect(stripVisible("library", null, makePlayer(), 0)).toBe(false);
  });

  it("hides when player is null, no session, no downloads", () => {
    expect(stripVisible("watchlist", null, null, 0)).toBe(false);
  });

  it("shows when a session is active regardless of player/downloads", () => {
    expect(stripVisible("library", makeSession({ state: "queued" }), makePlayer(), 0)).toBe(true);
  });

  it("shows when the player is actively playing", () => {
    expect(
      stripVisible("watchlist", null, makePlayer({ media_state: "OBS_MEDIA_STATE_PLAYING" }), 0)
    ).toBe(true);
  });

  it("shows when the player is paused", () => {
    expect(
      stripVisible("add", null, makePlayer({ media_state: "OBS_MEDIA_STATE_PAUSED" }), 0)
    ).toBe(true);
  });

  it("hides when the player has ended (stopped, not active)", () => {
    expect(stripVisible("stats", null, makePlayer({ media_state: "OBS_MEDIA_STATE_ENDED" }), 0)).toBe(
      false
    );
  });

  it("shows when there are active downloads only (downloads-only visibility)", () => {
    expect(stripVisible("settings", null, makePlayer(), 2)).toBe(true);
  });

  it("hides when downloads count is zero and nothing else is active", () => {
    expect(stripVisible("add", null, makePlayer(), 0)).toBe(false);
  });

  it("shows on a non-tonight tab when player is buffering/opening (active states)", () => {
    expect(
      stripVisible("library", null, makePlayer({ media_state: "OBS_MEDIA_STATE_BUFFERING" }), 0)
    ).toBe(true);
    expect(
      stripVisible("library", null, makePlayer({ media_state: "OBS_MEDIA_STATE_OPENING" }), 0)
    ).toBe(true);
  });
});

describe("stripTitle", () => {
  it("prefers the player's current item title", () => {
    expect(
      stripTitle(makePlayer({ current: makeQueueItem({ title: "Player Pick" }) }), makeSession({ watchlist_item_title: "Session Pick" }))
    ).toBe("Player Pick");
  });

  it("falls back to session watchlist_item_title when player has no current item", () => {
    expect(stripTitle(makePlayer(), makeSession({ watchlist_item_title: "Watchlist Pick" }))).toBe(
      "Watchlist Pick"
    );
  });

  it("falls back to session library_item_title when no watchlist title", () => {
    expect(stripTitle(makePlayer(), makeSession({ library_item_title: "Library Pick" }))).toBe(
      "Library Pick"
    );
  });

  it("falls back to an em-dash when nothing is available", () => {
    expect(stripTitle(makePlayer(), null)).toBe("—");
    expect(stripTitle(null, null)).toBe("—");
  });
});

describe("stripStateLabel", () => {
  it("labels playing/paused/ended/idle correctly", () => {
    expect(stripStateLabel(makePlayer({ media_state: "OBS_MEDIA_STATE_PLAYING" }))).toBe("Playing");
    expect(stripStateLabel(makePlayer({ media_state: "OBS_MEDIA_STATE_PAUSED" }))).toBe("Paused");
    expect(stripStateLabel(makePlayer({ media_state: "OBS_MEDIA_STATE_ENDED" }))).toBe("Ended");
    expect(stripStateLabel(makePlayer())).toBe("Idle");
    expect(stripStateLabel(null)).toBe("Idle");
  });
});

describe("sessionStageLabel", () => {
  it("returns undefined when there is no session", () => {
    expect(sessionStageLabel(null)).toBeUndefined();
  });

  it("maps each in-progress session state to a label, and ended to undefined", () => {
    expect(sessionStageLabel(makeSession({ state: "picking" }))).toBe("Picking");
    expect(sessionStageLabel(makeSession({ state: "queued" }))).toBe("Queued");
    expect(sessionStageLabel(makeSession({ state: "playing" }))).toBe("Playing");
    expect(sessionStageLabel(makeSession({ state: "rating" }))).toBe("Rating");
    expect(sessionStageLabel(makeSession({ state: "ended" }))).toBeUndefined();
  });
});
