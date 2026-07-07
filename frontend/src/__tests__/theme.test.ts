import { beforeEach, describe, expect, it } from "vitest";
import {
  CUSTOM_STORAGE_KEY,
  DEFAULT_THEME,
  THEME_STORAGE_KEY,
  THEMES,
  applyTheme,
  getStoredCustom,
  getStoredTheme,
  isThemeId,
  setCustomTheme,
  setTheme,
} from "../theme";

const style = () => document.documentElement.style;

describe("theme", () => {
  beforeEach(() => {
    window.localStorage.clear();
    delete document.documentElement.dataset.theme;
    style().cssText = "";
  });

  it("accepts every declared theme id plus custom, and rejects junk", () => {
    for (const t of THEMES) expect(isThemeId(t.id)).toBe(true);
    expect(isThemeId("custom")).toBe(true);
    expect(isThemeId("hotpink")).toBe(true);
    expect(isThemeId("not-a-theme")).toBe(false);
    expect(isThemeId(null)).toBe(false);
    expect(isThemeId(42)).toBe(false);
  });

  it("falls back to the default theme when storage is empty or invalid", () => {
    expect(getStoredTheme()).toBe(DEFAULT_THEME);
    window.localStorage.setItem(THEME_STORAGE_KEY, "not-a-theme");
    expect(getStoredTheme()).toBe(DEFAULT_THEME);
  });

  it("round-trips a stored CSS theme via the html attribute", () => {
    setTheme("ember");
    expect(getStoredTheme()).toBe("ember");
    expect(document.documentElement.dataset.theme).toBe("ember");
    expect(style().getPropertyValue("--brand-500")).toBe("");
  });

  it("clears the html attribute for the default theme", () => {
    applyTheme("graphite");
    expect(document.documentElement.dataset.theme).toBe("graphite");
    applyTheme(DEFAULT_THEME);
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it("injects inline vars for a derived preset and clears them on a CSS theme", () => {
    applyTheme("hotpink");
    expect(document.documentElement.dataset.theme).toBe("hotpink");
    expect(style().getPropertyValue("--brand-500").trim()).not.toBe("");
    // Switching to a CSS theme must remove the inline overrides.
    applyTheme("graphite");
    expect(style().getPropertyValue("--brand-500")).toBe("");
  });

  it("round-trips custom colors and applies them live when custom is active", () => {
    setTheme("custom");
    setCustomTheme({ accent: "#ff00aa", surface: "#101014" });
    expect(getStoredCustom()).toEqual({ accent: "#ff00aa", surface: "#101014" });
    expect(document.documentElement.dataset.theme).toBe("custom");
    expect(style().getPropertyValue("--brand-500").trim()).toBe("255 0 170");
  });

  it("does not apply custom colors live when a different theme is active", () => {
    setTheme("velvet");
    setCustomTheme({ accent: "#ff00aa", surface: "#101014" });
    // stored, but velvet is still active — no inline override
    expect(getStoredCustom().accent).toBe("#ff00aa");
    expect(style().getPropertyValue("--brand-500")).toBe("");
  });

  it("falls back to the default custom colors when stored JSON is invalid", () => {
    window.localStorage.setItem(CUSTOM_STORAGE_KEY, "{not json");
    expect(getStoredCustom().accent).toMatch(/^#/);
  });
});
