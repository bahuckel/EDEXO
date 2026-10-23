"use strict";

/*
  A HUD overlay window's BrowserWindow options (hudWindows.cjs createHudOverlayWindow; moved out, audit 2026-10-22).
  Frameless, transparent, always on top, never focused, in a session of its own.
*/

/**
 * @param {number} width
 * @param {number} height
 * @param {any} icon  the window icon, or null
 * @param {string} preloadPath
 */
function hudWindowOptions(width, height, icon, preloadPath) {
  return {
    width,
    height,
    frame: false,
    transparent: true,
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    focusable: false,
    thickFrame: false,
    icon: icon ?? undefined,
    titleBarStyle: "hidden",
    backgroundColor: "#00000000",
    webPreferences: {
      // A transparent window over a fullscreen game can be judged hidden, and Chromium then slows its
      // timers to once a second: the tracker's distance and the radar froze (plan 2.1, Fable C10).
      backgroundThrottling: false,
      // No spell-check: Electron can fetch its dictionaries from Google (owner, 2026-09-29).
      spellcheck: false,
      nodeIntegration: false,
      contextIsolation: true,
      // The same bridge the launcher gets. Without it `window.edexoElectron` is undefined in the
      // overlay pages, `resizeHudOverlay` silently no-ops, and every HUD stays at the size it was
      // opened with — which is why the tracker's radar was cut off at the bottom.
      preload: preloadPath,
      // `sandbox: false` is the only explicit opt-out in the app. The overlays are frameless,
      // transparent, always-on-top windows whose rendering cannot be verified from a test or a
      // headless run, and changing the packaged app on an untested assumption is how §31 happened.
      // Flip it, launch the app, and open the overlays before committing.
      sandbox: false,
      /*
        A session of their own (owner, 2026-09-26): Chromium keeps one zoom per site per session, and
        the HUDs are the launcher's site, so zooming the launcher zoomed every overlay. Their
        settings do not need the launcher's localStorage: with none of their own they read the
        server's mirror of it (`hudPrefs` in each snapshot, pushed on every change — the phone HUD
        has always worked that way).
      */
      partition: "persist:hud",
    },
  };
}

module.exports = { hudWindowOptions };
