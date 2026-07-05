import { beforeEach, describe, expect, it } from "vitest";
import {
  loadStreamFilters,
  loadStreamPresets,
  saveStreamFilters,
  saveStreamPresets,
  type StreamFilterPreset,
  type StreamFilterState,
} from "../streamFilters";

const STORAGE_KEY = "vrc-movie-night-stream-filters";
const PRESETS_STORAGE_KEY = "vrc-movie-night-stream-filter-presets";

function makeFilters(overrides: Partial<StreamFilterState> = {}): StreamFilterState {
  return {
    searchText: "",
    minRes: "",
    codec: "",
    maxSize: "",
    cachedOnly: false,
    minSeeders: "",
    sortBy: "quality",
    audioLang: "",
    subtitleType: "",
    preferDub: false,
    indexer: "",
    releaseGroup: "",
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
});

describe("streamFilters persistence", () => {
  it("round-trips saved filters through loadStreamFilters", () => {
    const filters: StreamFilterState = {
      searchText: "some query",
      minRes: "1080p",
      codec: "x265",
      maxSize: "10",
      cachedOnly: true,
      minSeeders: "5",
      sortBy: "size",
      audioLang: "dub",
      subtitleType: "softsub",
      preferDub: true,
      indexer: "RARBG",
      releaseGroup: "SPARKS",
    };
    saveStreamFilters(filters);
    const loaded = loadStreamFilters();
    // searchText is intentionally excluded from persistence.
    expect(loaded).toEqual({ ...filters, searchText: "" });
  });

  it("does not persist searchText across save/load", () => {
    saveStreamFilters({
      searchText: "should not persist",
      minRes: "",
      codec: "",
      maxSize: "",
      cachedOnly: false,
      minSeeders: "",
      sortBy: "quality",
      audioLang: "",
      subtitleType: "",
      preferDub: false,
      indexer: "",
      releaseGroup: "",
    });
    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    expect(raw as string).not.toContain("should not persist");
    expect(loadStreamFilters().searchText).toBe("");
  });

  it("returns defaults when localStorage is empty", () => {
    const loaded = loadStreamFilters();
    expect(loaded).toEqual({
      searchText: "",
      minRes: "",
      codec: "",
      maxSize: "",
      cachedOnly: false,
      minSeeders: "",
      sortBy: "quality",
      audioLang: "",
      subtitleType: "",
      preferDub: false,
      indexer: "",
      releaseGroup: "",
    });
  });

  it("returns defaults when localStorage contains corrupt JSON", () => {
    localStorage.setItem(STORAGE_KEY, "not json");
    const loaded = loadStreamFilters();
    expect(loaded.sortBy).toBe("quality");
    expect(loaded.cachedOnly).toBe(false);
  });

  it("merges old persisted state lacking newer keys (indexer/releaseGroup) over defaults", () => {
    // Simulates a state saved before indexer/releaseGroup existed.
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        minRes: "1080p",
        codec: "HEVC",
        maxSize: "",
        cachedOnly: true,
        minSeeders: "",
        sortBy: "quality",
        audioLang: "",
        subtitleType: "",
        preferDub: false,
      })
    );
    const loaded = loadStreamFilters();
    expect(loaded.minRes).toBe("1080p");
    expect(loaded.codec).toBe("HEVC");
    expect(loaded.cachedOnly).toBe(true);
    expect(loaded.indexer).toBe("");
    expect(loaded.releaseGroup).toBe("");
  });
});

describe("streamFilters presets persistence", () => {
  it("round-trips saved presets through loadStreamPresets", () => {
    const list: StreamFilterPreset[] = [
      { name: "Movie night", filters: makeFilters({ minRes: "1080p", cachedOnly: true }) },
      { name: "Anime dub", filters: makeFilters({ audioLang: "dub", preferDub: true }) },
    ];
    saveStreamPresets(list);
    expect(loadStreamPresets()).toEqual(list);
  });

  it("overwrites a preset with the same name rather than duplicating it", () => {
    const original: StreamFilterPreset[] = [
      { name: "Movie night", filters: makeFilters({ minRes: "720p" }) },
    ];
    saveStreamPresets(original);

    const updated: StreamFilterPreset[] = [
      { name: "Movie night", filters: makeFilters({ minRes: "1080p", cachedOnly: true }) },
    ];
    saveStreamPresets(updated);

    const loaded = loadStreamPresets();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].filters.minRes).toBe("1080p");
    expect(loaded[0].filters.cachedOnly).toBe(true);
  });

  it("returns an empty array when localStorage is empty", () => {
    expect(loadStreamPresets()).toEqual([]);
  });

  it("returns an empty array when localStorage contains corrupt JSON", () => {
    localStorage.setItem(PRESETS_STORAGE_KEY, "not json");
    expect(loadStreamPresets()).toEqual([]);
  });

  it("returns an empty array when localStorage contains a non-array value", () => {
    localStorage.setItem(PRESETS_STORAGE_KEY, JSON.stringify({ not: "an array" }));
    expect(loadStreamPresets()).toEqual([]);
  });

  it("deleting a preset removes it and keeps the rest", () => {
    const list: StreamFilterPreset[] = [
      { name: "A", filters: makeFilters() },
      { name: "B", filters: makeFilters() },
    ];
    saveStreamPresets(list);
    const afterDelete = list.filter((p) => p.name !== "A");
    saveStreamPresets(afterDelete);
    const loaded = loadStreamPresets();
    expect(loaded.map((p) => p.name)).toEqual(["B"]);
  });

  it("does not touch the existing single-state filters key", () => {
    saveStreamFilters(makeFilters({ minRes: "1080p" }));
    saveStreamPresets([{ name: "A", filters: makeFilters() }]);
    // The original filters key must remain independent of the presets key.
    const rawFilters = localStorage.getItem(STORAGE_KEY);
    expect(rawFilters).not.toBeNull();
    expect(JSON.parse(rawFilters as string).minRes).toBe("1080p");
  });
});
