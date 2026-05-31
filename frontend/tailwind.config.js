/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          950: "#070a12",
          900: "#0b0f1a",
          850: "#0f1422",
          800: "#141a2b",
          700: "#1c2438",
          600: "#27314a",
          500: "#3a4766",
        },
        brand: {
          400: "#7c9cff",
          500: "#5b7cfa",
          600: "#4860e6",
        },
        accent: {
          400: "#a78bfa",
          500: "#8b5cf6",
        },
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(124,156,255,0.15), 0 8px 30px rgba(0,0,0,0.45)",
      },
    },
  },
  plugins: [],
};
