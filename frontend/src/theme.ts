import { THEME_VAR_NAMES, deriveThemeVars, isHexColor, previewSwatch } from "./themeColors";

export type ThemeId =
  | "velvet"
  | "graphite"
  | "ember"
  | "projector"
  | "hotpink"
  | "blush"
  | "neon"
  | "mint"
  | "ocean"
  | "sunset"
  | "orchid"
  | "crimson"
  | "forest"
  | "ice"
  | "custom";

export const DEFAULT_THEME: ThemeId = "velvet";
export const THEME_STORAGE_KEY = "mn_theme";
export const CUSTOM_STORAGE_KEY = "mn_theme_custom";

export interface ThemeOption {
  id: ThemeId;
  label: string;
  description: string;
  /** Preview swatches for the Settings picker: [surface, card, accent, text]. */
  swatch: [string, string, string, string];
  /** CSS themes have their tokens in index.css; derived themes compute them from accent+surface. */
  kind: "css" | "derived";
  accent?: string;
  surface?: string;
}

interface DerivedSpec {
  id: ThemeId;
  label: string;
  description: string;
  accent: string;
  surface: string;
}

// New presets — defined purely by an accent + surface pair and expanded at
// runtime by deriveThemeVars, so adding a theme is a one-line change.
const DERIVED: DerivedSpec[] = [
  { id: "hotpink", label: "Hot Pink", description: "Electric magenta on near-black.", accent: "#ff3d8b", surface: "#161219" },
  { id: "blush", label: "Blush", description: "Soft pastel pink on dark mauve.", accent: "#f4a6c8", surface: "#1a1620" },
  { id: "neon", label: "Neon", description: "Cyberpunk cyan on deep teal-black.", accent: "#22d3ee", surface: "#0e1418" },
  { id: "mint", label: "Mint", description: "Fresh mint-green on dark pine.", accent: "#34d399", surface: "#101815" },
  { id: "ocean", label: "Ocean", description: "Clean azure on navy-black.", accent: "#3b82f6", surface: "#0d1420" },
  { id: "sunset", label: "Sunset", description: "Warm coral on toasted dark.", accent: "#ff6b4a", surface: "#1a1210" },
  { id: "orchid", label: "Orchid", description: "Rich violet on dark plum.", accent: "#c084fc", surface: "#17121c" },
  { id: "crimson", label: "Crimson", description: "Rose-red on dark maroon.", accent: "#f43f5e", surface: "#180f12" },
  { id: "forest", label: "Forest", description: "Vivid leaf-green on forest-black.", accent: "#4ade80", surface: "#0f1712" },
  { id: "ice", label: "Ice", description: "Icy sky-blue on cool slate.", accent: "#7dd3fc", surface: "#121821" },
];

export const THEMES: ThemeOption[] = [
  {
    id: "velvet",
    label: "Velvet",
    description: "Curtain-dark warm surfaces with a brass-gold accent.",
    swatch: ["#181114", "#20181c", "#d5a253", "#f0e9e7"],
    kind: "css",
  },
  {
    id: "graphite",
    label: "Graphite",
    description: "Pure grayscale — poster art is the only color.",
    swatch: ["#121212", "#1a1a1a", "#f0f0f0", "#ededed"],
    kind: "css",
  },
  {
    id: "ember",
    label: "Ember",
    description: "Cool graphite surfaces with a burnt-orange accent.",
    swatch: ["#14161a", "#1b1f25", "#dc6740", "#e9eaee"],
    kind: "css",
  },
  {
    id: "projector",
    label: "Projector",
    description: "Warm charcoal with a tungsten-amber accent.",
    swatch: ["#131211", "#1b1918", "#dd9c33", "#ede9e2"],
    kind: "css",
  },
  ...DERIVED.map((d): ThemeOption => ({
    id: d.id,
    label: d.label,
    description: d.description,
    accent: d.accent,
    surface: d.surface,
    kind: "derived",
    swatch: previewSwatch(d.accent, d.surface),
  })),
];

export interface CustomTheme {
  accent: string;
  surface: string;
}

export const DEFAULT_CUSTOM: CustomTheme = { accent: "#ff3d8b", surface: "#161219" };

const CSS_THEME_IDS = new Set<ThemeId>(["velvet", "graphite", "ember", "projector"]);
const ALL_IDS = new Set<ThemeId>([...THEMES.map((t) => t.id), "custom"]);

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === "string" && ALL_IDS.has(value as ThemeId);
}

export function getStoredTheme(): ThemeId {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemeId(stored) ? stored : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

export function getStoredCustom(): CustomTheme {
  try {
    const raw = window.localStorage.getItem(CUSTOM_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (isHexColor(parsed?.accent) && isHexColor(parsed?.surface)) {
        return { accent: parsed.accent, surface: parsed.surface };
      }
    }
  } catch {
    // fall through to default
  }
  return DEFAULT_CUSTOM;
}

const INLINE_PROPS = THEME_VAR_NAMES.map((n) => `--${n}`);

function clearInlineVars(): void {
  const s = document.documentElement.style;
  for (const p of INLINE_PROPS) s.removeProperty(p);
}

function setInlineVars(vars: Record<string, string>): void {
  const s = document.documentElement.style;
  for (const [name, value] of Object.entries(vars)) s.setProperty(`--${name}`, value);
}

/**
 * Applies a theme to <html>. CSS themes toggle `data-theme` (index.css holds
 * their tokens); derived and custom themes inject the computed tokens as
 * inline custom properties (which override any CSS theme). The default theme
 * clears the attribute so `:root` applies.
 */
export function applyTheme(id: ThemeId): void {
  clearInlineVars();

  if (id === "custom") {
    const c = getStoredCustom();
    document.documentElement.dataset.theme = "custom";
    setInlineVars(deriveThemeVars(c.accent, c.surface));
    return;
  }

  const theme = THEMES.find((t) => t.id === id) ?? THEMES[0];
  if (CSS_THEME_IDS.has(theme.id)) {
    if (theme.id === DEFAULT_THEME) delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme.id;
    return;
  }

  // derived preset
  document.documentElement.dataset.theme = theme.id;
  setInlineVars(deriveThemeVars(theme.accent!, theme.surface!));
}

export function setTheme(id: ThemeId): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, id);
  } catch {
    // Persistence is best-effort; the theme still applies for this session.
  }
  applyTheme(id);
}

/** Persists custom colors and, if Custom is the active theme, re-applies live. */
export function setCustomTheme(custom: CustomTheme): void {
  try {
    window.localStorage.setItem(CUSTOM_STORAGE_KEY, JSON.stringify(custom));
  } catch {
    // best-effort
  }
  if (getStoredTheme() === "custom") applyTheme("custom");
}

export { previewSwatch };
