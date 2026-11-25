// @ts-check
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
      /*
        Sandboxed like every other window of the app (plan 1.8). Was the one opt-out until 2026-11-25: the overlays'
        rendering cannot be checked from a test, so it waited for a run of the real app. Checked then from the repo
        on an isolated profile: nine HUDs opened in the shared host (hudHost.cjs) and again each in a window of its
        own (shareRenderer off), the preload's bridge was there and each page sized itself through it, the screenshots
        matched the unsandboxed run, no new page errors, and the screen marker's capture opened at full size. The
        preload only requires "electron" and reads process.argv, both there in a sandbox (tests/hudWindowOptions.test.ts).
      */
      sandbox: true,
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
