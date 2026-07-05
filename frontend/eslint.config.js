import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  { ignores: ["dist", "node_modules"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Existing code uses these patterns; keep as warnings for now.
      "@typescript-eslint/no-explicit-any": "warn",
      "react-hooks/exhaustive-deps": "warn",
      // AMENDED 2026-07-05: eslint-plugin-react-hooks@7 ships React-Compiler-era
      // rules that flag existing effect-body patterns wholesale (33+ hits).
      // Fixing them means restructuring effects — a deliberate future refactor,
      // not a lint rollout. Demote to warnings; burn down over time.
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/immutability": "warn",
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  }
);
