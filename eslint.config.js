// Flat config (ESLint 9). Many rules are warnings, and `npm run lint` passes --max-warnings 0
// (review F-F10, 2026-10-02, at zero warnings): a new warning fails the lint like an error.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import prettier from "eslint-config-prettier";
import globals from "globals";

export default tseslint.config(
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      "build/**",
      "data/**",
      "docs/**",
      ".edexo-cache/**",
      // Local screenshots, backups and one-off probes; never shipped, never imported.
      "build-artifacts/**",
      // The local scratch folder (excluded from git in .git/info/exclude): it failed `npm run lint` on this
      // machine with 23 errors that are nobody's code (code review A19).
      "tmp-t/**",
      // The Tauri test shell (docs/plan-25102026-tauri-1.4.0.md): its own Rust project; the shim is checked by hand.
      "tauri/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,

      // TypeScript already resolves identifiers; `no-undef` only produces false positives here.
      "no-undef": "off",

      // Signal we actually care about for the perf work in v0.4.0.
      "react-hooks/exhaustive-deps": "warn",

      // The codebase uses `catch { /* ignore */ }` and leading-underscore throwaways widely.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-non-null-assertion": "off",
      "no-empty": ["warn", { allowEmptyCatch: true }],
    },
  },
  {
    // The server bundles to CJS and lazily `require()`s electron; that is deliberate.
    files: ["src/server/**/*.ts"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  {
    /*
      Type-aware rules on the server (review 2026-11-10 E6, plan 2.6): a promise nobody awaits or catches is an
      unhandled rejection, and in the server it can stop a request answering. All at zero when added (2026-11-11).
      Async route handlers are allowed where Express wants a void function: httpServer.ts's catchAsyncRejections
      catches their rejections for every route.
    */
    files: ["src/server/**/*.ts"],
    languageOptions: {
      parserOptions: { project: "./tsconfig.server.json", tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": ["error", { checksVoidReturn: { arguments: false, returns: false } }],
      "@typescript-eslint/await-thenable": "error",
    },
  },
  {
    // Electron main/preload and build helpers are plain CommonJS Node scripts.
    files: ["**/*.cjs"],
    languageOptions: {
      sourceType: "commonjs",
      globals: { ...globals.node },
    },
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  {
    /*
      The build, release and probe scripts (linted since 2026-09-29; they were ignored, and 114 errors
      had piled up — 105 of them only Node's globals, undeclared for .mjs). Node globals; for .ts the
      same leniency as src, since TypeScript already resolves identifiers there.
    */
    files: ["scripts/**/*.{mjs,js,ts}"],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
      "no-empty": ["warn", { allowEmptyCatch: true }],
    },
  },
  {
    files: ["scripts/**/*.ts"],
    rules: { "no-undef": "off" },
  },
  {
    // The tests throw values away the way src does (`const { computedAt: _x, ...rest } = …`).
    files: ["tests/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
      ],
    },
  },
  {
    // The Inara helper Chrome extension (MV3, moved from EDEXO-Colonize at 1.3.0): browser + extension globals.
    files: ["chrome-extension/**/*.js"],
    languageOptions: {
      sourceType: "script",
      globals: { ...globals.browser, ...globals.webextensions },
    },
  },
  {
    // The launcher's modules (src/client/launcher, plain JavaScript built by Vite since 1.3.1): browser globals, the
    // same leniency as the plain scripts in public/ they came from.
    files: ["src/client/launcher/**/*.js"],
    languageOptions: {
      sourceType: "module",
      globals: { ...globals.browser },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
      ],
      "no-empty": ["warn", { allowEmptyCatch: true }],
    },
  },
  {
    // The HUD overlays' plain browser script (no bundler): browser globals, plus the `module` check
    // it does at the bottom so tests can require it. Same leniency as src for throwaway catches.
    files: ["public/**/*.js"],
    languageOptions: {
      sourceType: "script",
      globals: { ...globals.browser, module: "readonly" },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
      ],
      "no-empty": ["warn", { allowEmptyCatch: true }],
    },
  },
  {
    /*
      One number format (owner 2026-11-12, plan Q14: "5,000,000 format only"): a number's toLocaleString() follows the
      Windows locale (his groups with a space), so a bare call is refused; numbers pass "en-US" (or use shared/format.ts).
      A date that should follow the Windows locale says so with an explicit `undefined`.
    */
    files: ["src/**/*.{ts,tsx,js}"],
    ignores: ["**/*.gen.ts"],
    rules: {
      "no-restricted-syntax": [
        "warn",
        {
          selector: "CallExpression[callee.property.name='toLocaleString'][arguments.length=0]",
          message: 'Pass "en-US" for a number (5,000,000 everywhere), or `undefined` for a date in the Windows locale.',
        },
      ],
    },
  },
  {
    /*
      File size cap (item 27, after the 1.3.1 splits): 1,200 code lines, blank lines and comments not counted. A warning,
      so it fails `npm run lint`. The files still over it have their own cap, their size when the cap came in rounded up
      to the next hundred: they may not grow past it, and a split brings the line down (lower it when one lands). Tests
      and generated tables are not capped.
    */
    files: ["src/**/*.{ts,tsx,js}", "electron/**/*.cjs", "public/**/*.js", "scripts/**/*.{mjs,js,ts}"],
    ignores: ["**/*.gen.ts"],
    rules: { "max-lines": ["warn", { max: 1200, skipBlankLines: true, skipComments: true }] },
  },
  ...Object.entries({
    "src/client/galaxy3d/GalaxyEngine.ts": 1900,
    "src/client/GalaxyMap3D.tsx": 1500,
  }).map(([file, max]) => ({
    files: [file],
    rules: { "max-lines": ["warn", { max, skipBlankLines: true, skipComments: true }] },
  })),
  prettier,
);
