/**
 * The GPU warm-up page (electron/gpuWarmup.cjs, item 20): the launcher's markup with its stylesheets inlined and no
 * script left, built from the web root on disk; never a file from outside it.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { warmupHtml, startGpuWarmup } = require("../electron/gpuWarmup.cjs") as {
  warmupHtml: (webRoot: string) => string | null;
  startGpuWarmup: (o: object) => { done: () => void };
};

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function webRoot(): string {
  const parent = mkdtempSync(path.join(tmpdir(), "edexo-warm-"));
  dirs.push(parent);
  const root = path.join(parent, "web");
  mkdirSync(path.join(root, "assets"), { recursive: true });
  writeFileSync(path.join(parent, "secret.css"), ".secret{}");
  writeFileSync(path.join(root, "tokens.css"), ":root{--hud:#f80}");
  writeFileSync(path.join(root, "assets", "launcher-abc.css"), ".btn{clip-path:polygon(0 0,1px 0,0 1px)}");
  writeFileSync(
    path.join(root, "launcher.html"),
    [
      "<!doctype html><html><head>",
      '<link rel="stylesheet" href="/tokens.css" />',
      '<script type="module" crossorigin src="/assets/launcher-abc.js"></script>',
      '<link rel="modulepreload" crossorigin href="/assets/presets.js">',
      '<link rel="stylesheet" crossorigin href="/assets/launcher-abc.css">',
      '<link rel="stylesheet" href="/../secret.css">',
      "</head><body><h1>EDEXO</h1><script>alert(1)</script></body></html>",
    ].join("\n"),
  );
  return root;
}

describe("the GPU warm-up page", () => {
  it("inlines the launcher's stylesheets and drops every script", () => {
    const html = warmupHtml(webRoot())!;
    expect(html).toContain("<style>:root{--hud:#f80}</style>");
    expect(html).toContain("<style>.btn{clip-path:polygon(0 0,1px 0,0 1px)}</style>");
    expect(html).toContain("<h1>EDEXO</h1>");
    expect(html).not.toMatch(/<script|modulepreload|<link/i);
  });

  it("reads nothing outside the web root", () => {
    expect(warmupHtml(webRoot())).not.toContain(".secret");
  });

  it("is nothing without a built launcher, and then starts no window", () => {
    const empty = mkdtempSync(path.join(tmpdir(), "edexo-warm-none-"));
    dirs.push(empty);
    expect(warmupHtml(empty)).toBeNull();
    let made = 0;
    const BrowserWindow = function () {
      made++;
    };
    startGpuWarmup({ BrowserWindow, webRoot: empty }).done();
    expect(made).toBe(0);
  });

  it("closes its window when done, but never while it is the only one", () => {
    const destroyed: string[] = [];
    let all: object[] = [];
    class FakeWindow {
      webContents = { setWindowOpenHandler: () => {}, on: () => {} };
      constructor() {
        all.push(this);
      }
      loadURL() {
        return Promise.resolve();
      }
      isDestroyed() {
        return destroyed.includes("warm");
      }
      destroy() {
        destroyed.push("warm");
        all = all.filter((w) => w !== this);
      }
      static getAllWindows() {
        return all;
      }
    }
    const w = startGpuWarmup({ BrowserWindow: FakeWindow, webRoot: webRoot(), maxMs: 60_000 });
    w.done();
    expect(destroyed).toEqual([]);
    all.push({ launcher: true });
    w.done();
    expect(destroyed).toEqual(["warm"]);
    w.done();
    expect(destroyed).toEqual(["warm"]);
  });
});
