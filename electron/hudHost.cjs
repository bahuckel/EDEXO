"use strict";

/**
 * One renderer process for every HUD panel window (owner, 2026-10-26: "do the HUD panels" — memory).
 *
 * Each panel window used to start a renderer of its own, about 40 MB each. A hidden host window loads a blank page
 * from the app's server (public/hud-host.html) and opens the panel windows with `window.open`; Chromium puts a
 * same-site window opened that way in its opener's process. Measured on a windowless probe: host + 3 panels in one
 * process 69 MB, against ~40 MB per panel as separate windows. The panels get exactly the options a HUD window always
 * had (setWindowOpenHandler → overrideBrowserWindowOptions), the same session and the same preload.
 *
 * The cost: the panels share one JavaScript thread, and a crash of that process takes every panel with it (the
 * caller reopens them; `onGone`). If the host cannot open a window within OPEN_TIMEOUT_MS, the caller falls back to
 * a window of its own, as before.
 */

const OPEN_TIMEOUT_MS = 3000;

/**
 * @param {object} o
 * @param {typeof import("electron").BrowserWindow} o.BrowserWindow
 * @param {(width: number, height: number, icon?: unknown) => object} o.windowOptions  the HUD window's BrowserWindow options
 * @param {() => string | null} o.baseUrl  the server's address
 * @param {(msg: string) => void} [o.log]
 * @param {() => void} [o.onGone]  the host's process went away: every panel window with it
 */
function createHudHost(o) {
  let host = null;
  let ready = null;
  let seq = 0;
  /** name → { resolve, options } for the window.open calls in flight */
  const pending = new Map();

  function ensureHost() {
    if (host && !host.isDestroyed() && ready) return ready;
    const base = o.baseUrl();
    if (!base) return Promise.reject(new Error("Server not ready yet."));
    const opts = o.windowOptions(404, 330);
    host = new o.BrowserWindow({ ...opts, show: false, x: -32000, y: -32000, width: 1, height: 1 });
    const wc = host.webContents;
    wc.setWindowOpenHandler((details) => {
      const p = pending.get(details.frameName);
      if (!p || details.url !== "about:blank") return { action: "deny" };
      return { action: "allow", overrideBrowserWindowOptions: p.options };
    });
    wc.on("did-create-window", (win, details) => {
      const p = pending.get(details.frameName);
      if (!p) return;
      pending.delete(details.frameName);
      /*
        Handed over once its about:blank has finished: that navigation starts after the window exists, and a page
        loaded into the window before it ends was cancelled by it (ERR_ABORTED on every panel's first load). A
        second at most.
      */
      const child = win.webContents;
      let handed = false;
      const hand = () => {
        if (handed) return;
        handed = true;
        clearTimeout(cap);
        p.resolve(win);
      };
      const cap = setTimeout(hand, 1000);
      if (typeof child.once === "function") {
        child.once("did-finish-load", hand);
        child.once("did-fail-load", hand);
      } else hand();
    });
    wc.on("render-process-gone", (_e, d) => {
      o.log?.(`hud host process gone (${d && d.reason})`);
      const gone = host;
      host = null;
      ready = null;
      try {
        if (gone && !gone.isDestroyed()) gone.destroy();
      } catch {
        /* going */
      }
      o.onGone?.();
    });
    ready = wc.loadURL(`${base}/hud-host.html`).then(
      () => undefined,
      (e) => {
        ready = null;
        throw e;
      },
    );
    return ready;
  }

  /**
   * A HUD window in the host's process, its page about:blank (the caller loads the panel's page into it), or null
   * when the host could not make one (the caller then makes a window of its own).
   *
   * @returns {Promise<import("electron").BrowserWindow | null>}
   */
  async function open(width, height, icon) {
    try {
      await ensureHost();
    } catch (e) {
      o.log?.(`hud host not ready (${e instanceof Error ? e.message : String(e)})`);
      return null;
    }
    const name = `edexo-hud-${++seq}`;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        pending.delete(name);
        o.log?.("hud host: window.open timed out");
        resolve(null);
      }, OPEN_TIMEOUT_MS);
      pending.set(name, {
        options: o.windowOptions(width, height, icon),
        resolve: (win) => {
          clearTimeout(timer);
          resolve(win);
        },
      });
      host.webContents.executeJavaScript(`void window.open("about:blank", ${JSON.stringify(name)}, ""); 0`).catch((e) => {
        clearTimeout(timer);
        pending.delete(name);
        o.log?.(`hud host: window.open failed (${e instanceof Error ? e.message : String(e)})`);
        resolve(null);
      });
    });
  }

  function dispose() {
    for (const p of pending.values()) p.resolve(null);
    pending.clear();
    try {
      if (host && !host.isDestroyed()) host.destroy();
    } catch {
      /* going */
    }
    host = null;
    ready = null;
  }

  return { open, dispose, hostWindow: () => host };
}

module.exports = { createHudHost };
