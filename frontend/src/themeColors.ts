/**
 * Pure color math for derived themes. A theme is defined by two hexes — an
 * accent and a surface — and this expands them into the full CSS-variable
 * token set (the same names the static CSS themes and tailwind.config.js
 * use). Shared by the built-in derived presets and by user Custom themes so
 * both look consistent.
 */
export type Rgb = [number, number, number];

const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));

export function hexToRgb(hex: string): Rgb {
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const hex2 = (n: number) => clamp(n).toString(16).padStart(2, "0");
export const rgbToHex = (c: Rgb) => `#${hex2(c[0])}${hex2(c[1])}${hex2(c[2])}`;

export function isHexColor(value: unknown): value is string {
  return typeof value === "string" && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value.trim());
}

const mix = (a: Rgb, b: Rgb, t: number): Rgb => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];
const WHITE: Rgb = [255, 255, 255];
const BLACK: Rgb = [0, 0, 0];
const lighten = (c: Rgb, t: number) => mix(c, WHITE, t);
const darken = (c: Rgb, t: number) => mix(c, BLACK, t);

/** Perceived brightness 0..1 (sRGB weights) — good enough to pick ink text. */
export const luminance = ([r, g, b]: Rgb): number => (0.299 * r + 0.587 * g + 0.114 * b) / 255;

const triplet = (c: Rgb) => `${clamp(c[0])} ${clamp(c[1])} ${clamp(c[2])}`;

/** Every CSS custom property a theme controls (without the leading `--`). */
export const THEME_VAR_NAMES = [
  "ink-950",
  "ink-900",
  "ink-850",
  "ink-800",
  "ink-700",
  "ink-600",
  "ink-500",
  "brand-400",
  "brand-500",
  "brand-600",
  "brand-ink",
  "tx-100",
  "tx-200",
  "tx-300",
  "tx-400",
  "tx-500",
  "tx-600",
] as const;

// Text ramps: index 0 is the strongest text, 5 the faintest. Light ramp for
// dark surfaces, dark ramp for light surfaces — so text always contrasts.
const LIGHT_TEXT: Rgb[] = [
  [245, 246, 248],
  [235, 236, 239],
  [206, 208, 214],
  [163, 165, 174],
  [138, 140, 150],
  [99, 101, 111],
];
const DARK_TEXT: Rgb[] = [
  [24, 26, 31],
  [44, 46, 53],
  [74, 77, 86],
  [108, 111, 122],
  [138, 141, 152],
  [172, 175, 186],
];

/**
 * Expand an accent+surface pair into the full token set as RGB-triplet
 * strings ("24 17 20"), keyed by variable name (no leading `--`).
 */
export function deriveThemeVars(accentHex: string, surfaceHex: string): Record<string, string> {
  const A = hexToRgb(accentHex);
  const S = hexToRgb(surfaceHex);
  const darkSurface = luminance(S) < 0.5;

  // Ink scale steps away from the surface toward white; the page background
  // (ink-950) sits a touch darker than the card base (ink-900).
  const ink: Record<string, Rgb> = {
    "ink-950": darken(S, 0.12),
    "ink-900": S,
    "ink-850": lighten(S, 0.03),
    "ink-800": lighten(S, 0.075),
    "ink-700": lighten(S, 0.13),
    "ink-600": lighten(S, 0.22),
    "ink-500": lighten(S, 0.33),
  };

  // Accent scale + the text color placed ON the accent (dark for light
  // accents like pastels, near-white for saturated/dark accents).
  const inkText: Rgb = luminance(A) > 0.6 ? darken(A, 0.82) : [247, 248, 250];

  const textRamp = darkSurface ? LIGHT_TEXT : DARK_TEXT;
  const tx = (i: number) => mix(textRamp[i], A, 0.06); // faint accent tint for cohesion

  return {
    "ink-950": triplet(ink["ink-950"]),
    "ink-900": triplet(ink["ink-900"]),
    "ink-850": triplet(ink["ink-850"]),
    "ink-800": triplet(ink["ink-800"]),
    "ink-700": triplet(ink["ink-700"]),
    "ink-600": triplet(ink["ink-600"]),
    "ink-500": triplet(ink["ink-500"]),
    "brand-400": triplet(lighten(A, 0.18)),
    "brand-500": triplet(A),
    "brand-600": triplet(darken(A, 0.15)),
    "brand-ink": triplet(inkText),
    "tx-100": triplet(tx(0)),
    "tx-200": triplet(tx(1)),
    "tx-300": triplet(tx(2)),
    "tx-400": triplet(tx(3)),
    "tx-500": triplet(tx(4)),
    "tx-600": triplet(tx(5)),
  };
}

/** Four representative hexes for a Settings picker swatch: surface, card, accent, text. */
export function previewSwatch(accentHex: string, surfaceHex: string): [string, string, string, string] {
  const S = hexToRgb(surfaceHex);
  const A = hexToRgb(accentHex);
  const textBase = luminance(S) < 0.5 ? LIGHT_TEXT[0] : DARK_TEXT[0];
  return [surfaceHex, rgbToHex(lighten(S, 0.04)), accentHex, rgbToHex(mix(textBase, A, 0.06))];
}
