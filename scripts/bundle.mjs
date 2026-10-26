import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import esbuild from "esbuild";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const expressViewStub = path.resolve(__dirname, "express-view-stub.cjs");

mkdirSync("build", { recursive: true });

/*
  Minified (owner, 2026-10-26: server memory). V8 keeps every script's source text in memory for lazy compilation, and
  the unminified app.cjs was 3.9 MB of it (7.5 MB in the heap snapshot); minified it parses faster too. Names are kept
  (Function.name / class names stay what the code says), and a source map is written beside each bundle for reading a
  crash log's stack; it is not packed (electron-builder.cjs lists the .cjs files only).
*/
const lean = { minify: true, keepNames: true, sourcemap: "external" };

await esbuild.build({
  entryPoints: ["src/server/devEntry.ts"],
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  outfile: "build/app.cjs",
  logLevel: "info",
  ...lean,
  plugins: [
    {
      name: "express-view-stub",
      setup(build) {
        build.onResolve({ filter: /^\.\/view$/ }, (args) => {
          const imp = args.importer?.replace(/\\/g, "/") ?? "";
          if (imp.includes("/express/lib/application.js")) {
            return { path: expressViewStub };
          }
        });
      },
    },
  ],
});

console.info("Wrote build/app.cjs");

/*
  The EDEXO browser's blocking engine (plan 9.1, electron/browserAdblockEntry.cjs): Ghostery's adblocker in one
  file, shipped outside the asar (electron-builder.cjs extraResources) so the main process can parse the filter
  lists in a worker thread from it.
*/
await esbuild.build({
  entryPoints: ["electron/browserAdblockEntry.cjs"],
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  outfile: "build/browser-adblock.cjs",
  logLevel: "info",
  ...lean,
});
console.info("Wrote build/browser-adblock.cjs");

/*
  The Colonisation candidate search's worker thread (src/server/finderWorker.ts, 2026-10-19): its own file beside
  app.cjs, which finderWorkerClient.ts starts with `new Worker`. Without it the search runs in the server's thread.
*/
await esbuild.build({
  entryPoints: ["src/server/finderWorker.ts"],
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  outfile: "build/finder-worker.cjs",
  logLevel: "info",
  ...lean,
});
console.info("Wrote build/finder-worker.cjs");

/**
 * Start the thing we just built and wait for it to say it is listening.
 *
 * The bundle can fail in ways nothing else sees: it is CJS, and `tsx`, `vitest` and `vite` all run
 * the same sources as ESM. `import.meta.url` is the clearest case — esbuild replaces `import.meta`
 * with an empty object in CJS output, so a module that resolves its own directory that way throws
 * *"The 'path' argument must be of type string or an instance of URL"* the moment it is imported.
 * That shipped, and the packaged app would not start, while every test and every dev run passed.
 *
 * Booting it once is the cheapest check that covers the whole class. `--no-smoke` skips it.
 */
async function smokeBoot() {
  const port = 7900 + Math.floor(Math.random() * 80);
  /*
   * A throwaway user-data directory, because this boot is killed on purpose.
   *
   * The smoke test waits for "HTTP + WS:", which the server prints *before* the journal replay has
   * finished, then kills the child mid-replay. Pointed at the real directory, that shuts a partly
   * filled store down over a good cache: on 2026-09-09 it left the owner's 7.8 MB cache at 125 kB
   * with a complete 247-file manifest, and every probe that read it afterwards measured 57 truth
   * bodies instead of 453 and reported the difference as a result.
   *
   * Building an app must not touch the data of the person building it.
   */
  const smokeHome = mkdtempSync(path.join(tmpdir(), "edexo-smoke-"));
  const child = spawn(process.execPath, ["build/app.cjs", "--host", "127.0.0.1", "--port", String(port)], {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, EDEXO_USER_DATA_DIR: smokeHome },
  });

  let output = "";
  let timer;
  const done = new Promise((resolve) => {
    const onChunk = (buf) => {
      output += String(buf);
      if (output.includes("HTTP + WS:")) resolve("listening");
    };
    child.stdout.on("data", onChunk);
    child.stderr.on("data", onChunk);
    child.on("exit", (code) => resolve(`exited with code ${code}`));
    // Cleared below, so a good boot does not hold the build open for the rest of the 90 s (F-F4).
    timer = setTimeout(() => resolve("timed out after 90s"), 90_000);
  });

  const outcome = await done;
  clearTimeout(timer);
  // Wait for the child to be gone before removing its folder: on Windows the rm raced the exit.
  const exited = child.exitCode !== null ? Promise.resolve() : new Promise((r) => child.once("exit", r));
  child.kill();
  await Promise.race([exited, new Promise((r) => setTimeout(r, 5_000).unref())]);
  rmSync(smokeHome, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  if (outcome !== "listening") {
    console.error(`\n[bundle] build/app.cjs did not start — ${outcome}\n`);
    console.error(output.trim().split("\n").slice(-12).join("\n"));
    process.exitCode = 1;
    return;
  }
  console.info(`Booted build/app.cjs on port ${port} and shut it down again.`);
}

if (!process.argv.includes("--no-smoke")) await smokeBoot();
