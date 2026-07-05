import { describe, expect, it } from "vitest";
import { fmtBytes, fmtDuration, fmtMs } from "../format";

describe("fmtBytes", () => {
  it("returns 0 B for zero", () => {
    expect(fmtBytes(0)).toBe("0 B");
  });

  it("formats sub-KB values with no decimal", () => {
    expect(fmtBytes(500)).toBe("500 B");
  });

  it("formats KB values with one decimal", () => {
    expect(fmtBytes(1536)).toBe("1.5 KB");
  });

  it("formats MB values with one decimal", () => {
    expect(fmtBytes(1024 * 1024 * 2.5)).toBe("2.5 MB");
  });

  it("formats GB values with one decimal", () => {
    expect(fmtBytes(1024 * 1024 * 1024 * 3)).toBe("3.0 GB");
  });
});

describe("fmtDuration", () => {
  it("returns 0:00 for zero seconds", () => {
    expect(fmtDuration(0)).toBe("0:00");
  });

  it("formats sub-minute durations as m:ss", () => {
    expect(fmtDuration(59)).toBe("0:59");
  });

  it("formats durations over an hour as h:mm:ss", () => {
    expect(fmtDuration(3661)).toBe("1:01:01");
  });

  it("returns 0:00 for negative seconds", () => {
    expect(fmtDuration(-5)).toBe("0:00");
  });
});

describe("fmtMs", () => {
  it("returns 0:00 for zero ms", () => {
    expect(fmtMs(0)).toBe("0:00");
  });

  it("formats sub-minute ms durations as m:ss", () => {
    expect(fmtMs(59000)).toBe("0:59");
  });

  it("formats ms durations over an hour as h:mm:ss", () => {
    expect(fmtMs(3661000)).toBe("1:01:01");
  });
});
