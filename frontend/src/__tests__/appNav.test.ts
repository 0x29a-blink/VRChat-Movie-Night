import { beforeEach, describe, expect, it } from "vitest";
import { readNavFromLocation, writeNavToLocation } from "../appNav";

beforeEach(() => {
  window.history.replaceState({}, "", "/");
});

describe("readNavFromLocation", () => {
  it("defaults to the tonight tab with no params", () => {
    window.history.replaceState({}, "", "/");
    expect(readNavFromLocation()).toEqual({
      tab: "tonight",
      watchlistGroupId: undefined,
      watchlistSection: undefined,
      addSource: undefined,
    });
  });

  it("falls back to defaults for an unknown tab value", () => {
    window.history.replaceState({}, "", "/?tab=not-a-real-tab");
    expect(readNavFromLocation().tab).toBe("tonight");
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

describe("appNav legacy aliases (plan 024 nav rename: Tonight is now canonical)", () => {
  it("canonicalizes the legacy 'downloads' value to 'add'", () => {
    window.history.replaceState({}, "", "/?tab=downloads");
    expect(readNavFromLocation().tab).toBe("add");
  });

  it("canonicalizes the legacy 'queue' value to 'tonight'", () => {
    window.history.replaceState({}, "", "/?tab=queue");
    expect(readNavFromLocation().tab).toBe("tonight");
  });

  it("canonicalizes the legacy 'checklist' value to 'tonight'", () => {
    window.history.replaceState({}, "", "/?tab=checklist");
    expect(readNavFromLocation().tab).toBe("tonight");
  });

  it("still parses the current canonical values unaffected by the alias mapping", () => {
    window.history.replaceState({}, "", "/?tab=tonight");
    expect(readNavFromLocation().tab).toBe("tonight");
    window.history.replaceState({}, "", "/?tab=add");
    expect(readNavFromLocation().tab).toBe("add");
  });

  it("still falls back to the tonight default for unknown values", () => {
    window.history.replaceState({}, "", "/?tab=not-a-real-tab");
    expect(readNavFromLocation().tab).toBe("tonight");
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
      addSource: undefined,
    });
    expect(window.location.search).not.toContain("group");
    expect(window.location.search).not.toContain("section");
  });

  it("clears stream params by default", () => {
    window.history.replaceState({}, "", "/?open=1&openStremio=2&media=3&tab=add");
    writeNavToLocation({ tab: "add" });
    const params = new URLSearchParams(window.location.search);
    expect(params.has("open")).toBe(false);
    expect(params.has("openStremio")).toBe(false);
    expect(params.has("media")).toBe(false);
  });

  it("preserves stream params when preserveStreamParams is true", () => {
    window.history.replaceState({}, "", "/?open=1&tab=add");
    writeNavToLocation({ tab: "add" }, true);
    const params = new URLSearchParams(window.location.search);
    expect(params.get("open")).toBe("1");
  });
});

describe("appNav addSource (UI v3 merged Browse tab)", () => {
  it("deep-links ?tab=add&sub=browse", () => {
    window.history.replaceState({}, "", "/?tab=add&sub=browse");
    const nav = readNavFromLocation();
    expect(nav.tab).toBe("add");
    expect(nav.addSource).toBe("browse");
    expect(nav.addBrowseSource).toBeUndefined();
  });

  it("parses every valid addSource value", () => {
    for (const sub of ["search", "browse", "youtube", "m3u8"] as const) {
      window.history.replaceState({}, "", `/?tab=add&sub=${sub}`);
      expect(readNavFromLocation().addSource).toBe(sub);
    }
  });

  it("parses the inner browse source from ?src=", () => {
    window.history.replaceState({}, "", "/?tab=add&sub=browse&src=aiostreams");
    expect(readNavFromLocation().addBrowseSource).toBe("aiostreams");
    window.history.replaceState({}, "", "/?tab=add&sub=browse&src=collections");
    expect(readNavFromLocation().addBrowseSource).toBe("collections");
  });

  it("ignores src when sub is not browse", () => {
    window.history.replaceState({}, "", "/?tab=add&sub=search&src=aiostreams");
    expect(readNavFromLocation().addBrowseSource).toBeUndefined();
  });

  it("falls back to undefined for a garbage sub value", () => {
    window.history.replaceState({}, "", "/?tab=add&sub=not-a-real-source");
    expect(readNavFromLocation().addSource).toBeUndefined();
  });

  it("round-trips addSource through writeNavToLocation", () => {
    writeNavToLocation({ tab: "add", addSource: "youtube" });
    const nav = readNavFromLocation();
    expect(nav.tab).toBe("add");
    expect(nav.addSource).toBe("youtube");
    expect(window.location.search).toContain("sub=youtube");
  });

  it("round-trips the inner browse source through writeNavToLocation", () => {
    writeNavToLocation({ tab: "add", addSource: "browse", addBrowseSource: "aiostreams" });
    const nav = readNavFromLocation();
    expect(nav.addSource).toBe("browse");
    expect(nav.addBrowseSource).toBe("aiostreams");
    expect(window.location.search).toContain("src=aiostreams");
  });

  it("drops sub and src from the URL when writing a non-add tab", () => {
    window.history.replaceState({}, "", "/?tab=add&sub=browse&src=aiostreams");
    writeNavToLocation({ tab: "library" });
    expect(window.location.search).not.toContain("sub");
    expect(window.location.search).not.toContain("src");
    expect(readNavFromLocation().addSource).toBeUndefined();
  });

  it("drops sub from the URL when writing the add tab without an addSource", () => {
    window.history.replaceState({}, "", "/?tab=add&sub=browse");
    writeNavToLocation({ tab: "add" });
    expect(window.location.search).not.toContain("sub");
  });
});

describe("appNav legacy addSource aliases", () => {
  it("maps legacy ?sub=catalogs to browse/aiostreams", () => {
    window.history.replaceState({}, "", "/?tab=add&sub=catalogs");
    const nav = readNavFromLocation();
    expect(nav.addSource).toBe("browse");
    expect(nav.addBrowseSource).toBe("aiostreams");
  });

  it("maps legacy ?sub=collections to browse/collections", () => {
    window.history.replaceState({}, "", "/?tab=add&sub=collections");
    const nav = readNavFromLocation();
    expect(nav.addSource).toBe("browse");
    expect(nav.addBrowseSource).toBe("collections");
  });

  it("maps ancient ?sub=anime to browse/aiostreams", () => {
    window.history.replaceState({}, "", "/?tab=add&sub=anime");
    const nav = readNavFromLocation();
    expect(nav.addSource).toBe("browse");
    expect(nav.addBrowseSource).toBe("aiostreams");
  });

  it("explicit ?src= wins over a legacy alias hint", () => {
    window.history.replaceState({}, "", "/?tab=add&sub=catalogs&src=collections");
    expect(readNavFromLocation().addBrowseSource).toBe("collections");
  });
});
