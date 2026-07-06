import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_THEME,
  THEME_STORAGE_KEY,
  THEMES,
  applyTheme,
  getStoredTheme,
  isThemeId,
  setTheme,
} from "../theme";

describe("theme", () => {
  beforeEach(() => {
    window.localStorage.clear();
    delete document.documentElement.dataset.theme;
  });

  it("accepts every declared theme id and rejects junk", () => {
    for (const t of THEMES) expect(isThemeId(t.id)).toBe(true);
    expect(isThemeId("neon")).toBe(false);
    expect(isThemeId(null)).toBe(false);
    expect(isThemeId(42)).toBe(false);
  });

  it("falls back to the default theme when storage is empty or invalid", () => {
    expect(getStoredTheme()).toBe(DEFAULT_THEME);
    window.localStorage.setItem(THEME_STORAGE_KEY, "not-a-theme");
    expect(getStoredTheme()).toBe(DEFAULT_THEME);
  });

  it("round-trips a stored theme", () => {
    setTheme("ember");
    expect(getStoredTheme()).toBe("ember");
    expect(document.documentElement.dataset.theme).toBe("ember");
  });

  it("clears the html attribute for the default theme", () => {
    applyTheme("graphite");
    expect(document.documentElement.dataset.theme).toBe("graphite");
    applyTheme(DEFAULT_THEME);
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });
});
