import { describe, expect, it } from "vitest";
import {
  THEME_VAR_NAMES,
  deriveThemeVars,
  hexToRgb,
  isHexColor,
  luminance,
  previewSwatch,
  rgbToHex,
} from "../themeColors";

describe("themeColors — parsing", () => {
  it("parses 6- and 3-digit hex", () => {
    expect(hexToRgb("#ff3d8b")).toEqual([255, 61, 139]);
    expect(hexToRgb("#fff")).toEqual([255, 255, 255]);
    expect(hexToRgb("000000")).toEqual([0, 0, 0]);
  });

  it("round-trips rgb<->hex", () => {
    expect(rgbToHex([255, 61, 139])).toBe("#ff3d8b");
    expect(rgbToHex([0, 0, 0])).toBe("#000000");
  });

  it("validates hex strings", () => {
    expect(isHexColor("#abc")).toBe(true);
    expect(isHexColor("#a1b2c3")).toBe(true);
    expect(isHexColor("abc")).toBe(false);
    expect(isHexColor("#gggggg")).toBe(false);
    expect(isHexColor(42)).toBe(false);
  });
});

describe("themeColors — deriveThemeVars", () => {
  const vars = deriveThemeVars("#ff3d8b", "#161219");

  it("produces every theme variable as an in-range RGB triplet", () => {
    for (const name of THEME_VAR_NAMES) {
      const v = vars[name];
      expect(v, `missing ${name}`).toBeTruthy();
      const parts = v.split(" ").map(Number);
      expect(parts).toHaveLength(3);
      for (const p of parts) {
        expect(p).toBeGreaterThanOrEqual(0);
        expect(p).toBeLessThanOrEqual(255);
        expect(Number.isInteger(p)).toBe(true);
      }
    }
  });

  it("sets brand-500 to the exact accent", () => {
    expect(vars["brand-500"]).toBe("255 61 139");
  });

  it("uses dark ink text on a light accent and near-white on a dark accent", () => {
    const onPastel = deriveThemeVars("#f4a6c8", "#1a1620");
    const onDeep = deriveThemeVars("#3b82f6", "#0d1420");
    const lum = (t: string) => luminance(t.split(" ").map(Number) as [number, number, number]);
    expect(lum(onPastel["brand-ink"])).toBeLessThan(0.4); // dark text on pastel
    expect(lum(onDeep["brand-ink"])).toBeGreaterThan(0.8); // light text on deep blue
  });

  it("flips the text ramp so text contrasts a light surface", () => {
    const darkBg = deriveThemeVars("#ff3d8b", "#161219");
    const lightBg = deriveThemeVars("#ff3d8b", "#f2eef4");
    const lum = (t: string) => luminance(t.split(" ").map(Number) as [number, number, number]);
    expect(lum(darkBg["tx-100"])).toBeGreaterThan(0.8); // light text on dark bg
    expect(lum(lightBg["tx-100"])).toBeLessThan(0.3); // dark text on light bg
  });
});

describe("themeColors — previewSwatch", () => {
  it("returns four hex colors starting with the surface and including the accent", () => {
    const sw = previewSwatch("#ff3d8b", "#161219");
    expect(sw).toHaveLength(4);
    expect(sw[0]).toBe("#161219");
    expect(sw[2]).toBe("#ff3d8b");
    for (const c of sw) expect(isHexColor(c)).toBe(true);
  });
});
