export type ThemeId = "velvet" | "graphite" | "ember" | "projector";

export const DEFAULT_THEME: ThemeId = "velvet";
export const THEME_STORAGE_KEY = "mn_theme";

export interface ThemeOption {
  id: ThemeId;
  label: string;
  description: string;
  /** Preview swatches for the Settings picker: [surface, card, accent, text] */
  swatch: [string, string, string, string];
}

export const THEMES: ThemeOption[] = [
  {
    id: "velvet",
    label: "Velvet",
    description: "Curtain-dark warm surfaces with a brass-gold accent.",
    swatch: ["#181114", "#20181c", "#d5a253", "#f0e9e7"],
  },
  {
    id: "graphite",
    label: "Graphite",
    description: "Pure grayscale — poster art is the only color.",
    swatch: ["#121212", "#1a1a1a", "#f0f0f0", "#ededed"],
  },
  {
    id: "ember",
    label: "Ember",
    description: "Cool graphite surfaces with a burnt-orange accent.",
    swatch: ["#14161a", "#1b1f25", "#dc6740", "#e9eaee"],
  },
  {
    id: "projector",
    label: "Projector",
    description: "Warm charcoal with a tungsten-amber accent.",
    swatch: ["#131211", "#1b1918", "#dd9c33", "#ede9e2"],
  },
];

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === "string" && THEMES.some((t) => t.id === value);
}

export function getStoredTheme(): ThemeId {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemeId(stored) ? stored : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

/** Sets the active theme on <html>. The default theme clears the attribute. */
export function applyTheme(id: ThemeId): void {
  if (id === DEFAULT_THEME) {
    delete document.documentElement.dataset.theme;
  } else {
    document.documentElement.dataset.theme = id;
  }
}

export function setTheme(id: ThemeId): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, id);
  } catch {
    // Persistence is best-effort; the theme still applies for this session.
  }
  applyTheme(id);
}
