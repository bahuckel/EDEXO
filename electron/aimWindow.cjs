"use strict";

/*
  The screen marker's window (owner, 2026-11-04: "a dot in a circle on the screen where you need to point at"): one
  frameless, transparent, click-through window over the whole of the game's monitor, loading aim-overlay.html. On
  with the launcher's switch (off by default); shown only while the HUDs are (not hidden with the hotkey, the game
  running and, with "hide when unfocused", in front). The page draws nothing until there is a composition-scanned
  plant on the planet underfoot or flown over, so the window costs nothing to leave open.

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
 * }} deps
 */
function createAimWindow(deps) {
  /** @type {any} */
  let win = null;
  let on = false;
  let disposed = false;

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
    void win.loadURL(`${base}/aim-overlay.html`).then(
      () => sync(),
      () => close(),
    );
  }

  function close() {
    const w = win;
    win = null;
    if (w && !w.isDestroyed()) w.destroy();
  }

  /** Open, show or hide as the switch and the HUDs' visibility say. */
  function sync() {
    if (disposed) return;
    if (!on) {
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

  return {
    /** The launcher's switch. */
    set(next) {
      on = next === true;
      sync();
      return on;
    },
    isOn: () => on,
    sync,
    dispose() {
      disposed = true;
      close();
    },
  };
}

module.exports = { createAimWindow };
