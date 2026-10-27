import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

/*
  The API the dev server proxies to. The e2e smoke (playwright.config.ts) runs its own API on
  another port so a packaged app already on 7111 can never answer for the fixture journal.
*/
const API = `127.0.0.1:${process.env.EDEXO_DEV_API_PORT || "7111"}`;
const DEV_PORT = Number(process.env.EDEXO_DEV_PORT || 5173);

export default defineConfig({
  // Tailwind compiles the utilities only; minifying stays with Vite as before 3.2, so the app's own rules are not
  // rewritten by a second optimiser.
  plugins: [react(), tailwindcss({ optimize: false })],
  root: "src/client",
  publicDir: "../../public",
  resolve: {
    alias: { "@shared": path.resolve(import.meta.dirname, "src/shared") },
  },
  server: {
    port: DEV_PORT,
    strictPort: true,
    proxy: {
      "/api": { target: `http://${API}`, changeOrigin: true },
      "/photos": { target: `http://${API}`, changeOrigin: true },
      // The species images the panel actually asks for. Without this the dev server answers with
      // its SPA fallback — HTTP 200, an HTML body, and every card showing "Image failed to load".
      "/species-photos": { target: `http://${API}`, changeOrigin: true },
      "/ws": { target: `ws://${API}`, ws: true, changeOrigin: true },
    },
  },
  build: {
    outDir: "../../dist/web",
    emptyOutDir: true,
    // What tsconfig targets, and what Electron and current phone browsers run; Vite's default
    // (es2020) down-levelled class fields and the like for nobody (plan 2.6, Fable 9.2).
    target: "es2022",
    rolldownOptions: {
      /*
        The app and the HUD overlay pages (React since 1.2.17, plan 3.8). The overlays keep their names, so their
        addresses — the Electron windows know them by path (electron/hudWindows.cjs), the phone by link — stay.
        The launcher too since 1.3.1 (discuss item 19): still /launcher.html, its script and styles hashed.
      */
      input: Object.fromEntries(
        [
          "index",
          "launcher",
          "hud-overlay",
          "jump-overlay",
          "fss-scan-overlay",
          "exo-candidates-overlay",
          "distance-overlay",
          "data-value-overlay",
          "achievement-overlay",
          "notable-overlay",
          "notices-overlay",
          "colonize-overlay",
          "ship-overlay",
        ].map((n) => [n, path.resolve(import.meta.dirname, "src/client", `${n}.html`)]),
      ),
      output: {
        // React changes far less often than app code; keeping it in its own chunk means a release
        // only invalidates the app chunk in the browser cache. three.js likewise: 600 of the galaxy
        // chunk's 620 kB, re-downloaded after every edit to the map's own code. (Vite 8 / Rolldown: groups by module
        // path; the object form of Rollup's manualChunks is gone.)
        codeSplitting: {
          groups: [
            { name: "react", test: /[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
            { name: "three", test: /[\\/]node_modules[\\/]three[\\/]/ },
          ],
        },
      },
    },
  },
});
