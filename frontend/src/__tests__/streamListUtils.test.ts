import { describe, expect, it } from "vitest";
import { filterAndSortStreams, streamKey } from "../streamListUtils";
import type { StreamFilterState } from "../streamFilters";
import type { StreamResult } from "../types";

function makeStream(overrides: Partial<StreamResult> = {}): StreamResult {
  return {
    url: "",
    name: "",
    description: "",
    filename: "",
    provider: "",
    resolution: "",
    resolution_rank: 0,
    codec: "",
    source: "",
    hdr: "",
    size_gb: 0,
    size_bytes: 0,
    seeders: 0,
    cached: false,
    playable: true,
    cacheable: true,
    audio_lang: "",
    subtitle_type: "",
    lang_tags: [],
    audio_lang_rank: 0,
    languages: [],
    subtitle_langs: [],
    audio_tags: [],
    visual_tags: [],
    release_group: "",
    network: "",
    indexer: "",
    magnet: "",
    info_hash: "",
    file_idx: null,
    ...overrides,
  };
}

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

describe("streamKey", () => {
  it("returns a stable key for the same object", () => {
    const s = makeStream({ url: "http://example.com/a" });
    expect(streamKey(s)).toBe(streamKey(s));
  });

  it("returns different keys for distinct streams", () => {
    const a = makeStream({ url: "http://example.com/a" });
    const b = makeStream({ url: "http://example.com/b" });
    expect(streamKey(a)).not.toBe(streamKey(b));
  });

  it("falls back to magnet then info_hash when url is empty", () => {
    const magnetOnly = makeStream({ url: "", magnet: "magnet:xyz" });
    expect(streamKey(magnetOnly)).toBe("magnet:xyz");
    const hashOnly = makeStream({ url: "", magnet: "", info_hash: "abc123" });
    expect(streamKey(hashOnly)).toBe("abc123");
  });
});

describe("filterAndSortStreams — resolution filter", () => {
  it("minRes 1080p keeps 2160p/1080p and drops 720p", () => {
    const streams = [
      makeStream({ name: "uhd", resolution_rank: 5 }),
      makeStream({ name: "fhd", resolution_rank: 3 }),
      makeStream({ name: "hd", resolution_rank: 2 }),
    ];
    const out = filterAndSortStreams(streams, makeFilters({ minRes: "1080p" }));
    const names = out.map((s) => s.name).sort();
    expect(names).toEqual(["fhd", "uhd"]);
  });
});

describe("filterAndSortStreams — cachedOnly filter", () => {
  it("keeps only cached streams", () => {
    const streams = [
      makeStream({ name: "cached-one", cached: true }),
      makeStream({ name: "not-cached", cached: false }),
    ];
    const out = filterAndSortStreams(streams, makeFilters({ cachedOnly: true }));
    expect(out.map((s) => s.name)).toEqual(["cached-one"]);
  });
});

describe("filterAndSortStreams — maxSize filter", () => {
  it("keeps a stream exactly at the maxSize boundary", () => {
    const streams = [makeStream({ name: "exact", size_gb: 5 })];
    const out = filterAndSortStreams(streams, makeFilters({ maxSize: "5" }));
    expect(out.map((s) => s.name)).toEqual(["exact"]);
  });

  it("drops a stream over the maxSize boundary", () => {
    const streams = [makeStream({ name: "over", size_gb: 5.01 })];
    const out = filterAndSortStreams(streams, makeFilters({ maxSize: "5" }));
    expect(out).toEqual([]);
  });

  it("drops streams with size_gb of 0 even under the limit", () => {
    // BUG?: filterAndSortStreams requires size_gb > 0 when maxSize is set,
    // so unknown/zero-size streams are silently excluded rather than kept.
    const streams = [makeStream({ name: "unknown-size", size_gb: 0 })];
    const out = filterAndSortStreams(streams, makeFilters({ maxSize: "5" }));
    expect(out).toEqual([]);
  });
});

describe("filterAndSortStreams — sorting", () => {
  it("sortBy size orders largest first", () => {
    const streams = [
      makeStream({ name: "small", size_gb: 1 }),
      makeStream({ name: "large", size_gb: 10 }),
      makeStream({ name: "medium", size_gb: 5 }),
    ];
    const out = filterAndSortStreams(streams, makeFilters({ sortBy: "size" }));
    expect(out.map((s) => s.name)).toEqual(["large", "medium", "small"]);
  });

  it("sortBy seeders orders most-seeded first", () => {
    const streams = [
      makeStream({ name: "few", seeders: 2 }),
      makeStream({ name: "many", seeders: 50 }),
      makeStream({ name: "none", seeders: 0 }),
    ];
    const out = filterAndSortStreams(streams, makeFilters({ sortBy: "seeders" }));
    expect(out.map((s) => s.name)).toEqual(["many", "few", "none"]);
  });

  it("sortBy quality orders by resolution rank, then cached, then seeders", () => {
    const streams = [
      makeStream({ name: "low-res", resolution_rank: 2, cached: true, seeders: 100 }),
      makeStream({ name: "high-res-uncached", resolution_rank: 5, cached: false, seeders: 1 }),
      makeStream({ name: "high-res-cached", resolution_rank: 5, cached: true, seeders: 1 }),
    ];
    const out = filterAndSortStreams(streams, makeFilters({ sortBy: "quality" }));
    expect(out.map((s) => s.name)).toEqual([
      "high-res-cached",
      "high-res-uncached",
      "low-res",
    ]);
  });
});

describe("filterAndSortStreams — indexer filter", () => {
  it("keeps only streams matching the selected indexer, case-insensitively", () => {
    const streams = [
      makeStream({ name: "rarbg-one", indexer: "RARBG" }),
      makeStream({ name: "yts-one", indexer: "YTS" }),
    ];
    const out = filterAndSortStreams(streams, makeFilters({ indexer: "rarbg" }));
    expect(out.map((s) => s.name)).toEqual(["rarbg-one"]);
  });

  it("empty indexer filter applies no filtering", () => {
    const streams = [
      makeStream({ name: "a", indexer: "RARBG" }),
      makeStream({ name: "b", indexer: "" }),
    ];
    const out = filterAndSortStreams(streams, makeFilters({ indexer: "" }));
    expect(out.map((s) => s.name).sort()).toEqual(["a", "b"]);
  });

  it("composes with cachedOnly", () => {
    const streams = [
      makeStream({ name: "cached-rarbg", indexer: "RARBG", cached: true }),
      makeStream({ name: "uncached-rarbg", indexer: "RARBG", cached: false }),
      makeStream({ name: "cached-yts", indexer: "YTS", cached: true }),
    ];
    const out = filterAndSortStreams(streams, makeFilters({ indexer: "RARBG", cachedOnly: true }));
    expect(out.map((s) => s.name)).toEqual(["cached-rarbg"]);
  });
});

describe("filterAndSortStreams — releaseGroup filter", () => {
  it("keeps only streams matching the selected release group, case-insensitively", () => {
    const streams = [
      makeStream({ name: "sparks-one", release_group: "SPARKS" }),
      makeStream({ name: "flux-one", release_group: "FLUX" }),
    ];
    const out = filterAndSortStreams(streams, makeFilters({ releaseGroup: "sparks" }));
    expect(out.map((s) => s.name)).toEqual(["sparks-one"]);
  });

  it("empty releaseGroup filter applies no filtering", () => {
    const streams = [
      makeStream({ name: "a", release_group: "SPARKS" }),
      makeStream({ name: "b", release_group: "" }),
    ];
    const out = filterAndSortStreams(streams, makeFilters({ releaseGroup: "" }));
    expect(out.map((s) => s.name).sort()).toEqual(["a", "b"]);
  });

  it("composes with cachedOnly", () => {
    const streams = [
      makeStream({ name: "cached-sparks", release_group: "SPARKS", cached: true }),
      makeStream({ name: "uncached-sparks", release_group: "SPARKS", cached: false }),
      makeStream({ name: "cached-flux", release_group: "FLUX", cached: true }),
    ];
    const out = filterAndSortStreams(
      streams,
      makeFilters({ releaseGroup: "SPARKS", cachedOnly: true })
    );
    expect(out.map((s) => s.name)).toEqual(["cached-sparks"]);
  });
});

describe("filterAndSortStreams — text search", () => {
  it("matches release name case-insensitively", () => {
    const streams = [
      makeStream({ name: "The.Matrix.1999.REMUX" }),
      makeStream({ name: "Inception.2010" }),
    ];
    const out = filterAndSortStreams(streams, makeFilters({ searchText: "matrix" }));
    expect(out.map((s) => s.name)).toEqual(["The.Matrix.1999.REMUX"]);
  });

  it("requires every whitespace-separated term to match", () => {
    const streams = [
      makeStream({ name: "The.Matrix.1999.REMUX" }),
      makeStream({ name: "The.Matrix.Reloaded.2003" }),
    ];
    const out = filterAndSortStreams(streams, makeFilters({ searchText: "matrix reloaded" }));
    expect(out.map((s) => s.name)).toEqual(["The.Matrix.Reloaded.2003"]);
  });
});
