import { beforeEach, describe, expect, it } from "vitest";
import { clearCacheForTests, readCache, writeCache } from "../swrCache";
import { WATCHLIST_GROUPS_KEY, watchlistItemsKey } from "../watchlistCache";

describe("swrCache", () => {
  beforeEach(clearCacheForTests);

  it("returns undefined for a cold key", () => {
    expect(readCache("nope")).toBeUndefined();
  });

  it("round-trips a value", () => {
    writeCache("k", { a: 1 });
    expect(readCache<{ a: number }>("k")).toEqual({ a: 1 });
  });

  it("overwrites on repeated writes", () => {
    writeCache("k", 1);
    writeCache("k", 2);
    expect(readCache("k")).toBe(2);
  });
});

describe("watchlist cache keys", () => {
  it("items keys are distinct per group and section", () => {
    const keys = new Set([
      watchlistItemsKey(0, "to_watch"),
      watchlistItemsKey(0, "watched"),
      watchlistItemsKey(3, "to_watch"),
      WATCHLIST_GROUPS_KEY,
    ]);
    expect(keys.size).toBe(4);
  });
});
