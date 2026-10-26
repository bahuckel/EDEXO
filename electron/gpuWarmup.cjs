"use strict";

/**
 * The graphics card warmed up while the server starts (discuss item 20, measured 2026-10-25).
 *
 * The launcher's first paint came ~420 ms after its page had loaded, against ~25 ms for the same page in a second
 * window: the first page with the launcher's look (chamfered clip-paths, glows, gradients) makes the GPU process
 * prepare what it draws them with, once per run. The launcher paid that after the server's ~400 ms start, every
 * start. Here a hidden window draws the launcher's own markup and stylesheets from disk while the server starts,
 * so that work is done when the real launcher arrives. Measured on the app run from the repo (4 starts each): the
 * launcher's first paint 1,150 → 800 ms after the process starts, 420 → 50 ms after its page loaded; the server's
 * start ~30 ms later for the extra renderer.
 *
 * The page is built here from the files on disk: no scripts (stripped, and JavaScript off), no preload, no server,
 * a session of its own kept in memory. It is never shown and closes once the launcher has loaded.
 */

const fs = require("fs");
const path = require("path");

/**
 * The launcher's markup with its stylesheets inlined and every script removed, or null when the page is not there
 * (a dev run before `npm run build`). A stylesheet outside `webRoot` is left out.
 *
 * @param {string} webRoot
 * @returns {string | null}
 */
function warmupHtml(webRoot) {
  let html;
  try {
    html = fs.readFileSync(path.join(webRoot, "launcher.html"), "utf8");
  } catch {
    return null;
  }
  const root = path.resolve(webRoot);
  html = html
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<link\b[^>]*\brel="modulepreload"[^>]*>/gi, "")
    .replace(/<link\b[^>]*\brel="stylesheet"[^>]*>/gi, (tag) => {
      const href = /\bhref="([^"]+)"/i.exec(tag)?.[1] ?? "";
      const abs = path.resolve(root, ...href.split(/[?#]/)[0].split("/").filter(Boolean));
      if (!abs.startsWith(root + path.sep)) return "";
      try {
        return `<style>${fs.readFileSync(abs, "utf8")}</style>`;
      } catch {
        return "";
      }
    });
  return html;
}

/**
 * Start the hidden warm-up window. `done()` closes it; safe to call more than once, and it closes by itself after
 * `maxMs` whatever happens.
 *
 * @param {object} o
 * @param {typeof import("electron").BrowserWindow} o.BrowserWindow
 * @param {string} o.webRoot
 * @param {{ width?: number, height?: number }} [o.size]  the launcher's size, so the same area is drawn
 * @param {number} [o.maxMs]
 * @param {(msg: string) => void} [o.log]
 * @returns {{ done: () => void }}
 */
function startGpuWarmup(o) {
  const html = warmupHtml(o.webRoot);
  if (!html) return { done: () => {} };
  let win = null;
  try {
    win = new o.BrowserWindow({
      show: false,
      paintWhenInitiallyHidden: true,
      skipTaskbar: true,
      focusable: false,
      width: o.size?.width ?? 548,
      height: o.size?.height ?? 900,
      backgroundColor: "#050507",
      webPreferences: {
        partition: "edexo-gpu-warmup",
        javascript: false,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        spellcheck: false,
      },
    });
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    win.webContents.on("will-navigate", (e) => e.preventDefault());
    void win.loadURL(`data:text/html;charset=utf-8;base64,${Buffer.from(html).toString("base64")}`).catch(() => {});
  } catch (e) {
    o.log?.(`gpu warm-up not started (${e instanceof Error ? e.message : String(e)})`);
    win = null;
  }
  let timer = null;
  const done = () => {
    clearTimeout(timer);
    const w = win;
    if (!w) return;
    /*
      Never the last window: closing it then would quit the app (main.cjs, window-all-closed). Only reachable when
      the launcher is slower than maxMs; asked again a little later.
    */
    try {
      if (!w.isDestroyed() && o.BrowserWindow.getAllWindows().every((x) => x === w)) {
        timer = setTimeout(done, 2000);
        timer.unref?.();
        return;
      }
    } catch {
      /* closed below */
    }
    win = null;
    try {
      if (!w.isDestroyed()) w.destroy();
    } catch {
      /* already gone */
    }
  };
  timer = setTimeout(done, o.maxMs ?? 15_000);
  timer.unref?.();
  return { done };
}

module.exports = { startGpuWarmup, warmupHtml };
