import { configDefaults, defineConfig } from "vitest/config";
import { existsSync } from "node:fs";
import path from "node:path";

/**
 * `src/**` uses NodeNext-style specifiers (`./foo.js`) that TypeScript resolves to `./foo.ts`.
 * Vite resolves relative specifiers literally, so without this every server import fails to load.
 * Rewrites only when the sibling `.ts` / `.tsx` actually exists, so real `.js` files still win.
 */
function resolveTsFromJsSpecifier() {
  return {
    name: "edexo-resolve-ts-from-js",
    enforce: "pre" as const,
    resolveId(source: string, importer?: string) {
      if (!importer || !source.startsWith(".") || !source.endsWith(".js")) return null;
      const abs = path.resolve(path.dirname(importer), source);
      for (const ext of [".ts", ".tsx"]) {
        const candidate = `${abs.slice(0, -".js".length)}${ext}`;
        if (existsSync(candidate)) return candidate;
      }
      return null;
    },
  };
}

/**
 * Line and branch floors per folder: measured 2026-11-11 (server 74.0 / 62.6, shared 88.8 / 74.7, feeder 60.0 /
 * 49.0 %), less 2, rounded down. Reported without a floor: client 32.9 / 23.6, electron 62.8 / 54.2, cli 67.0 / 44.9.
 */
const COVERAGE_FLOORS = {
  "src/server/**": { lines: 72, branches: 60 },
  "src/shared/**": { lines: 86, branches: 72 },
  "src/feeder/**": { lines: 58, branches: 47 },
};

export default defineConfig({
  plugins: [resolveTsFromJsSpecifier()],
  resolve: {
    alias: { "@shared": path.resolve(import.meta.dirname, "src/shared") },
  },
  test: {
    include: ["tests/**/*.test.{ts,tsx}"],
    // The known-spawn suite takes ~5 minutes (two full snapshots for each of 439 bodies): it runs
    // when named — `npm run test:spawn` — and stays out of the everyday `npm test`.
    exclude: [
      ...configDefaults.exclude,
      ...(process.argv.some((a) => a.includes("speciesSpawnBodies")) ? [] : ["tests/speciesSpawnBodies.test.ts"]),
    ],
    // Every test file gets a throwaway EDEXO_USER_DATA_DIR before it runs. Without it a test that
    // resolves a user-data path touches the real one on the machine running the suite; see the file.
    // reactAct.ts: React's act() environment flag, for every component test.
    setupFiles: ["tests/setup/userDataDir.ts", "tests/setup/reactAct.ts"],
    // One temp folder per run, removed at the end: tests no longer leave folders in %TEMP%.
    globalSetup: ["tests/setup/globalTmp.ts"],
    environment: "node",
    // The species-database tests read data/species/**; keep them off the same worker clock as the
    // pure-function suites so a slow first read cannot fail an unrelated file.
    testTimeout: 20_000,
    /*
      Coverage, on demand (`npm run coverage`; plan 2.5): the server, the shared code and the feeder have floors, a
      couple of points under what they measured when set, so a change that leaves new code untested shows as a drop.
      Raise a floor when the figure has moved up for good (a ratchet, never lowered to pass). The client and Electron
      are reported, not floored: most of their code runs only in a window.
    */
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}", "electron/**/*.cjs"],
      reporter: ["text-summary", "json-summary"],
      reportsDirectory: "node_modules/.cache/edexo-coverage",
      thresholds: COVERAGE_FLOORS,
    },
  },
});
