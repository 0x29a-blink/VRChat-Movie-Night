import { beforeEach, describe, expect, it } from "vitest";
import { readNavFromLocation, writeNavToLocation } from "../appNav";

beforeEach(() => {
  window.history.replaceState({}, "", "/");
});

describe("readNavFromLocation", () => {
  it("defaults to the downloads tab with no params", () => {
    window.history.replaceState({}, "", "/");
    expect(readNavFromLocation()).toEqual({
      tab: "downloads",
      watchlistGroupId: undefined,
      watchlistSection: undefined,
    });
  });

  it("falls back to defaults for an unknown tab value", () => {
    window.history.replaceState({}, "", "/?tab=not-a-real-tab");
    expect(readNavFromLocation().tab).toBe("downloads");
  });

  it("falls back to defaults for a garbage section value", () => {
    window.history.replaceState({}, "", "/?tab=watchlist&section=bogus");
    const nav = readNavFromLocation();
    expect(nav.tab).toBe("watchlist");
    expect(nav.watchlistSection).toBeUndefined();
  });

  it("parses a valid tab, group, and section", () => {
    window.history.replaceState({}, "", "/?tab=watchlist&group=42&section=watched");
    expect(readNavFromLocation()).toEqual({
      tab: "watchlist",
      watchlistGroupId: 42,
      watchlistSection: "watched",
    });
  });
});

describe("appNav aliases (plan 023 groundwork for plan 022 nav rename)", () => {
  it("parses the 'tonight' alias as the existing queue panel", () => {
    window.history.replaceState({}, "", "/?tab=tonight");
    expect(readNavFromLocation().tab).toBe("queue");
  });

  it("parses the 'add' alias as the existing downloads panel", () => {
    window.history.replaceState({}, "", "/?tab=add");
    expect(readNavFromLocation().tab).toBe("downloads");
  });

  it("still parses old tab values unaffected by the alias mapping", () => {
    window.history.replaceState({}, "", "/?tab=queue");
    expect(readNavFromLocation().tab).toBe("queue");
    window.history.replaceState({}, "", "/?tab=checklist");
    expect(readNavFromLocation().tab).toBe("checklist");
  });

  it("still falls back to the downloads default for unknown values", () => {
    window.history.replaceState({}, "", "/?tab=not-a-real-tab");
    expect(readNavFromLocation().tab).toBe("downloads");
  });
});

describe("writeNavToLocation + readNavFromLocation round-trip", () => {
  it("round-trips tab and watchlist section", () => {
    writeNavToLocation({ tab: "watchlist", watchlistGroupId: 7, watchlistSection: "watched" });
    const nav = readNavFromLocation();
    expect(nav.tab).toBe("watchlist");
    expect(nav.watchlistGroupId).toBe(7);
    expect(nav.watchlistSection).toBe("watched");
  });

  it("round-trips a non-watchlist tab without group/section params", () => {
    writeNavToLocation({ tab: "library" });
    expect(readNavFromLocation()).toEqual({
      tab: "library",
      watchlistGroupId: undefined,
      watchlistSection: undefined,
    });
    expect(window.location.search).not.toContain("group");
    expect(window.location.search).not.toContain("section");
  });

  it("clears stream params by default", () => {
    window.history.replaceState({}, "", "/?open=1&openStremio=2&media=3&tab=downloads");
    writeNavToLocation({ tab: "downloads" });
    const params = new URLSearchParams(window.location.search);
    expect(params.has("open")).toBe(false);
    expect(params.has("openStremio")).toBe(false);
    expect(params.has("media")).toBe(false);
  });

  it("preserves stream params when preserveStreamParams is true", () => {
    window.history.replaceState({}, "", "/?open=1&tab=downloads");
    writeNavToLocation({ tab: "downloads" }, true);
    const params = new URLSearchParams(window.location.search);
    expect(params.get("open")).toBe("1");
  });
});
