"use strict";

/*
  The screen marker's window (owner, 2026-11-04: "a dot in a circle on the screen where you need to point at"): one
  frameless, transparent, click-through window over the whole of the game's monitor, loading aim-overlay.html. On
  with the launcher's switch (off by default); shown only while the HUDs are (not hidden with the hotkey, the game
  running and, with "hide when unfocused", in front). The page draws nothing until there is a composition-scanned
  plant on the planet underfoot or flown over, so the window costs nothing to leave open. With the pitch reader on,
  its page captures the game's monitor (displayMedia below: that screen only, to this page only), on this PC only.
  The Scan route's distance reader (the launcher's HUD option, plan 1.3.8) uses the same page and capture: with it on
  and the marker off, the window opens with `?marks=0` and draws no marks, only reads the target's distance.

  Electron is passed in (as hudWindows.cjs does) so a test can drive it with fakes.
*/
const { hudWindowOptions } = require("./hudWindowOptions.cjs");

/**
 * @param {{
 *   BrowserWindow: any,
 *   getBaseUrl: () => string | null,
 *   preloadPath: string,
 *   getDisplay: () => { bounds: { x: number, y: number, width: number, height: number } },
 *   isAllowed: () => boolean,
 *   guardWindow?: (win: any) => void,
 *   desktopCapturer?: any,
 * }} deps
 */
function createAimWindow(deps) {
  /** @type {any} */
  let win = null;
  let on = false;
  /** The distance reader (HUD prefs `distanceReader`): opens the window too, without the marks. */
  let reader = false;
  let disposed = false;
  /** The page's address as the switches want it. */
  const pageUrl = (base) => `${base}/aim-overlay.html${on ? "" : "?marks=0"}`;

  function place() {
    if (!win || win.isDestroyed()) return;
    const b = deps.getDisplay().bounds;
    const cur = win.getBounds();
    if (cur.x !== b.x || cur.y !== b.y || cur.width !== b.width || cur.height !== b.height) win.setBounds(b);
  }

  function open() {
    if (win || disposed) return;
    const base = deps.getBaseUrl();
    if (!base) {
      // The server is not up yet (the launcher asks at start): try again shortly.
      setTimeout(sync, 2000);
      return;
    }
    const b = deps.getDisplay().bounds;
    win = new deps.BrowserWindow({ ...hudWindowOptions(b.width, b.height, null, deps.preloadPath), x: b.x, y: b.y });
    deps.guardWindow?.(win);
    // Never in the way: every click goes through to the game.
    win.setIgnoreMouseEvents(true);
    win.setAlwaysOnTop(true, "screen-saver");
    win.on("closed", () => {
      win = null;
    });
    void win.loadURL(pageUrl(base)).then(
      () => sync(),
      () => close(),
    );
  }

  function close() {
    const w = win;
    win = null;
    if (w && !w.isDestroyed()) w.destroy();
  }

  /** Open, show or hide as the switches and the HUDs' visibility say. */
  function sync() {
    if (disposed) return;
    if (!on && !reader) {
      close();
      return;
    }
    if (!win) {
      open();
      return;
    }
    if (win.isDestroyed()) return;
    place();
    if (deps.isAllowed()) {
      if (!win.isVisible()) win.showInactive();
      win.setAlwaysOnTop(true, "screen-saver");
    } else if (win.isVisible()) win.hide();
  }

  /**
   * The pitch reader's capture (aim/pitchCapture.ts, the launcher's option): the page asks for the screen, and gets the
   * game's monitor only, and only when the request comes from this window's own page. Anything else gets nothing.
   */
  function displayMedia(request, callback) {
    const fromAim = win && !win.isDestroyed() && request && request.frame === win.webContents.mainFrame;
    if (!fromAim || !deps.desktopCapturer) return callback({});
    const want = String(deps.getDisplay().id ?? "");
    deps.desktopCapturer
      .getSources({ types: ["screen"], thumbnailSize: { width: 0, height: 0 } })
      .then((sources) => {
        const src = sources.find((s) => String(s.display_id) === want) ?? sources[0];
        callback(src ? { video: src } : {});
      })
      .catch(() => callback({}));
  }

  /** The marker switched while the page is open for the reader: load it again with or without the marks. */
  function reloadForMarks(was) {
    if (was === on || !win || win.isDestroyed() || !reader) return;
    const base = deps.getBaseUrl();
    if (base) void win.loadURL(pageUrl(base)).catch(() => {});
  }

  /** True for this window's own page (the only one the capture and its permission are for). */
  function isAimContents(wc) {
    return !!win && !win.isDestroyed() && wc === win.webContents;
  }

  /**
   * The game monitor's capture id, for this window's page only (2026-11-04: getDisplayMedia needs a click, and the
   * marker window is click-through, so the page asks for the screen by id through getUserMedia instead).
   */
  async function captureSource(sender) {
    if (!isAimContents(sender) || !deps.desktopCapturer) return null;
    const want = String(deps.getDisplay().id ?? "");
    try {
      const sources = await deps.desktopCapturer.getSources({ types: ["screen"], thumbnailSize: { width: 0, height: 0 } });
      const src = sources.find((s) => String(s.display_id) === want) ?? sources[0];
      return src ? src.id : null;
    } catch {
      return null;
    }
  }

  return {
    /** The launcher's switch. */
    set(next) {
      const was = on;
      on = next === true;
      reloadForMarks(was);
      sync();
      return on;
    },
    isOn: () => on,
    /** The distance reader (the launcher's HUD prefs, pushed at start and on each change). */
    setReader(next) {
      const was = reader;
      reader = next === true;
      if (was !== reader) sync();
      return reader;
    },
    displayMedia,
    isAimContents,
    captureSource,
    sync,
    dispose() {
      disposed = true;
      close();
    },
  };
}

module.exports = { createAimWindow };
