/** @type {import('tailwindcss').Config} */

// All palette values resolve to CSS variables defined per-theme in index.css.
// Values are RGB triplets ("24 17 20") so Tailwind alpha modifiers (bg-ink-850/70) keep working.
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          950: v("ink-950"),
          900: v("ink-900"),
          850: v("ink-850"),
          800: v("ink-800"),
          700: v("ink-700"),
          600: v("ink-600"),
          500: v("ink-500"),
        },
        brand: {
          300: v("brand-400"),
          400: v("brand-400"),
          500: v("brand-500"),
          600: v("brand-600"),
          // Text color for content sitting on a brand-500 surface (light accents
          // like Graphite need dark text, gold accents need near-black).
          ink: v("brand-ink"),
        },
        // Legacy alias — pre-theme code paired brand with a second purple hue.
        // Both now resolve to the single theme accent.
        accent: {
          400: v("brand-400"),
          500: v("brand-500"),
        },
        // Text scale. Overriding slate re-themes every existing text-slate-* usage.
        slate: {
          100: v("tx-100"),
          200: v("tx-200"),
          300: v("tx-300"),
          400: v("tx-400"),
          500: v("tx-500"),
          600: v("tx-600"),
        },
      },
      boxShadow: {
        // Former "glow" (accent halo) — now a plain ambient shadow.
        glow: "0 8px 30px rgba(0, 0, 0, 0.35)",
      },
    },
  },
  plugins: [],
};
