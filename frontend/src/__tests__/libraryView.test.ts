import { describe, expect, it } from "vitest";
import { filterAndSortLibrary } from "../libraryView";
import type { LibraryItem } from "../types";

function makeItem(overrides: Partial<LibraryItem> = {}): LibraryItem {
  return {
    id: 1,
    path: "",
    filename: "file.mp4",
    title: "Title",
    folder: "torrents",
    size: 0,
    duration: 0,
    thumbnail: "",
    added_at: "",
    ...overrides,
  };
}

describe("filterAndSortLibrary — query matching", () => {
  it("matches title case-insensitively", () => {
    const items = [
      makeItem({ id: 1, title: "The Matrix", filename: "matrix.mp4" }),
      makeItem({ id: 2, title: "Inception", filename: "inception.mp4" }),
    ];
    const out = filterAndSortLibrary(items, "matrix", "title");
    expect(out.map((i) => i.id)).toEqual([1]);
  });

  it("matches filename case-insensitively when title differs", () => {
    const items = [
      makeItem({ id: 1, title: "Movie One", filename: "The.Matrix.1999.mkv" }),
      makeItem({ id: 2, title: "Movie Two", filename: "inception.2010.mkv" }),
    ];
    const out = filterAndSortLibrary(items, "MATRIX", "title");
    expect(out.map((i) => i.id)).toEqual([1]);
  });

  it("prefers display_title over title for matching", () => {
    const items = [makeItem({ id: 1, title: "raw-file-name", display_title: "Pretty Title" })];
    const out = filterAndSortLibrary(items, "pretty", "title");
    expect(out.map((i) => i.id)).toEqual([1]);
  });

  it("empty query returns all items unfiltered", () => {
    const items = [makeItem({ id: 1 }), makeItem({ id: 2 })];
    const out = filterAndSortLibrary(items, "", "recent");
    expect(out.map((i) => i.id).sort()).toEqual([1, 2]);
  });

  it("returns empty array when nothing matches", () => {
    const items = [makeItem({ id: 1, title: "Alpha", filename: "alpha.mp4" })];
    const out = filterAndSortLibrary(items, "zzz-no-match", "recent");
    expect(out).toEqual([]);
  });
});

describe("filterAndSortLibrary — sort orders", () => {
  it("recent sorts by id descending (default)", () => {
    const items = [makeItem({ id: 1 }), makeItem({ id: 3 }), makeItem({ id: 2 })];
    const out = filterAndSortLibrary(items, "", "recent");
    expect(out.map((i) => i.id)).toEqual([3, 2, 1]);
  });

  it("title sorts A-Z using display_title or title", () => {
    const items = [
      makeItem({ id: 1, title: "Zebra" }),
      makeItem({ id: 2, title: "Apple" }),
      makeItem({ id: 3, display_title: "Mango" }),
    ];
    const out = filterAndSortLibrary(items, "", "title");
    expect(out.map((i) => i.id)).toEqual([2, 3, 1]);
  });

  it("duration sorts longest first", () => {
    const items = [
      makeItem({ id: 1, duration: 100 }),
      makeItem({ id: 2, duration: 300 }),
      makeItem({ id: 3, duration: 200 }),
    ];
    const out = filterAndSortLibrary(items, "", "duration");
    expect(out.map((i) => i.id)).toEqual([2, 3, 1]);
  });

  it("size sorts largest first", () => {
    const items = [
      makeItem({ id: 1, size: 1000 }),
      makeItem({ id: 2, size: 5000 }),
      makeItem({ id: 3, size: 2000 }),
    ];
    const out = filterAndSortLibrary(items, "", "size");
    expect(out.map((i) => i.id)).toEqual([2, 3, 1]);
  });
});

describe("filterAndSortLibrary — stable section grouping input/output", () => {
  it("preserves array length and identity of items across filter+sort (no mutation of caller's array)", () => {
    const items = [makeItem({ id: 1 }), makeItem({ id: 2 })];
    const original = items.slice();
    const out = filterAndSortLibrary(items, "", "recent");
    expect(items).toEqual(original);
    expect(out).toHaveLength(2);
  });

  it("composes query filter with each sort without dropping matches", () => {
    const items = [
      makeItem({ id: 1, title: "Show A", duration: 100 }),
      makeItem({ id: 2, title: "Show B", duration: 200 }),
      makeItem({ id: 3, title: "Other", duration: 50 }),
    ];
    const out = filterAndSortLibrary(items, "show", "duration");
    expect(out.map((i) => i.id)).toEqual([2, 1]);
  });
});
