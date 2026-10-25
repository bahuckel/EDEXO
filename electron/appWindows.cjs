"use strict";

/*
  The app's page windows (split out of main.cjs, discuss item 30, 1.3.1): the app window ("App window", owner
  2026-09-26), the Colonize window (1.3.0), and the galaxy map either of them opens. One of each at a time; asking
  again brings the open one forward.
*/
const fs = require("fs");
const path = require("path");
const { writeFileAtomic } = require("./atomicWrite.cjs");
const { WINDOW_MIN, enableZoom } = require("./windowState.cjs");
const { childWindowKind, galaxyWindowBounds } = require("./childWindows.cjs");
const { guardWindowNavigation, isOwnUrl } = require("./windowGuards.cjs");

/** The session the app, Colonize and torn-off tab windows share. */
const APP_WINDOW_PARTITION = "persist:app-window";

function createAppWindows({ electron, getRuntime, getMainWindow, getDiag, tabWindows, windowState, ownBase }) {
  const { BrowserWindow, screen, shell } = electron;
  const { readWindowStates, readWindowState, trackWindowState, windowStatePath } = windowState;
  let appUiWindow = null;

  /**
   * The app window's session is new, so its view settings (body sort, last tab, …) start empty. Copy
   * the launcher session's localStorage across once — same site, so the launcher can read it — and
   * reload. Marked done in window-state.json so it never runs again.
   */
  async function carryAppStorageOver(win) {
    const mainWindow = getMainWindow();
    const all = readWindowStates();
    if (all.appStorageCarried === true) return;
    try {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      const dump = await mainWindow.webContents.executeJavaScript(
        "JSON.stringify(Object.assign({}, window.localStorage))",
      );
      const n = await win.webContents.executeJavaScript(
        `(() => { const o = JSON.parse(${JSON.stringify(dump)}); let n = 0;` +
          ` for (const k of Object.keys(o)) { if (localStorage.getItem(k) === null) { localStorage.setItem(k, o[k]); n++; } }` +
          ` return n; })()`,
      );
      const now = readWindowStates();
      now.appStorageCarried = true;
      fs.mkdirSync(path.dirname(windowStatePath()), { recursive: true });
      writeFileAtomic(windowStatePath(), JSON.stringify(now, null, 2), "utf8");
      if (n > 0 && !win.isDestroyed()) win.webContents.reload();
    } catch (e) {
      console.warn("[edexo-compare] could not carry the app window's settings over:", e);
    }
  }

  /** The galaxy map's window while it is open (one at a time; see childWindows.cjs). */
  let galaxyWindow = null;

  /**
   * The links of an app page window (the app window, the Colonize window).
   *
   * Links out of the app (Spansh, EDSM, the site) go to the commander's browser; the app's own pages
   * may still open in a window of their own, as they did when the UI ran in the launcher.
   */
  function attachAppPageLinks(win, base, iconForChild) {
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith(`${base}/`) || url === base) {
        if (childWindowKind(url) !== "galaxy") return { action: "allow" };
        // One map window: a second click brings the open one forward instead of loading another.
        if (galaxyWindow && !galaxyWindow.isDestroyed()) {
          if (galaxyWindow.isMinimized()) galaxyWindow.restore();
          galaxyWindow.show();
          galaxyWindow.focus();
          return { action: "deny" };
        }
        const saved = readWindowState("galaxy");
        const area = screen.getDisplayMatching(win.getBounds()).workArea;
        return {
          action: "allow",
          overrideBrowserWindowOptions: {
            ...galaxyWindowBounds(saved, area),
            minWidth: WINDOW_MIN.galaxy.w,
            minHeight: WINDOW_MIN.galaxy.h,
            backgroundColor: "#050507",
            autoHideMenuBar: true,
            title: "Galaxy map — EDEXO",
            icon: iconForChild,
          },
        };
      }
      if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
      return { action: "deny" };
    });
    /*
      Every page window the app opens keeps the app's bridge (it inherits the preload), so none may wander off: its
      links out go to the commander's browser and it never navigates to another site (1.2.19 review: a target=_blank
      link on the privacy page opened an outside site in a window that still had the bridge).
    */
    win.webContents.on("will-navigate", (e, url) => {
      if (isOwnUrl(url, ownBase)) return;
      e.preventDefault();
      if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    });
    win.webContents.on("did-create-window", (child, { url }) => {
      guardWindowNavigation(child, ownBase, shell);
      if (childWindowKind(url) !== "galaxy") return;
      galaxyWindow = child;
      if (readWindowState("galaxy")?.maximized) child.maximize();
      trackWindowState("galaxy", child);
      enableZoom(child);
      child.on("closed", () => {
        if (galaxyWindow === child) galaxyWindow = null;
      });
    });
  }

  function openAppUiWindow(iconForChild) {
    const runtime = getRuntime();
    if (!runtime) return { opened: false, error: "Server not ready yet." };
    if (appUiWindow && !appUiWindow.isDestroyed()) {
      if (appUiWindow.isMinimized()) appUiWindow.restore();
      appUiWindow.show();
      appUiWindow.focus();
      return { opened: true, focused: true };
    }
    const base = runtime.getLocalBaseUrl();
    const saved = readWindowState("app");
    const area = screen.getPrimaryDisplay().workArea;
    const width = saved?.width ?? Math.min(1480, Math.round(area.width * 0.9));
    const height = saved?.height ?? Math.min(940, Math.round(area.height * 0.9));
    const preloadPath = path.join(__dirname, "preload.cjs");
    /*
      The app's own title bar (owner, 2026-10-06, Tab view): no Windows caption, Windows' own minimise /
      maximise / close drawn over the page (titleBarOverlay), and the page's tab strip as the bar you drag.
      The page knows from --edexo-custom-titlebar (preload.cjs). Windows only: elsewhere the frame stays.
    */
    const customTitleBar = process.platform === "win32";
    const win = new BrowserWindow({
      width,
      height,
      ...(saved ? { x: saved.x, y: saved.y } : {}),
      minWidth: WINDOW_MIN.app.w,
      minHeight: WINDOW_MIN.app.h,
      backgroundColor: "#050507",
      autoHideMenuBar: true,
      title: "EDEXO Compare",
      icon: iconForChild,
      ...(customTitleBar
        ? { titleBarStyle: "hidden", titleBarOverlay: { color: "#07060a", symbolColor: "#f0a050", height: 34 } }
        : {}),
      webPreferences: {
        additionalArguments: customTitleBar ? ["--edexo-custom-titlebar"] : [],
        /*
          Full speed while the game is in front (owner, 2026-10-07: Shift+F1 / F2 took 2-3 s in game, at
          once with the app in front). A window that is not in front gets throttled timers and painting;
          this one is meant to be read beside the game, as the HUDs are (hudWindows.cjs).
        */
        backgroundThrottling: false,
        // No spell-check: Electron can fetch its dictionaries from Google (owner, 2026-09-29).
        spellcheck: false,
        contextIsolation: true,
        nodeIntegration: false,
        partition: APP_WINDOW_PARTITION,
        preload: fs.existsSync(preloadPath) ? preloadPath : undefined,
      },
    });
    appUiWindow = win;
    tabWindows.attachMain(win);
    getDiag()?.watchWindow(win, "app");
    if (saved?.maximized) win.maximize();
    trackWindowState("app", win);
    enableZoom(win);
    attachAppPageLinks(win, base, iconForChild);
    win.webContents.once("did-finish-load", () => void carryAppStorageOver(win));
    win.on("closed", () => {
      if (appUiWindow === win) appUiWindow = null;
    });
    void win.loadURL(`${base}/`);
    // The windows its tabs were dragged out into last time.
    win.webContents.once("did-finish-load", () => tabWindows.restore());
    return { opened: true, focused: false };
  }

  /** The Colonize window while it is open (1.3.0): one at a time, beside the app window, never instead of it. */
  let colonizeWindow = null;

  /**
   * Colonize (1.3.0, owner 2026-10-18): the launcher's second button, a window of its own with its own main page
   * (`?screen=colonize`). Same server, same journal reader, same session as the app window, so the colour scheme and
   * the HUD's "an app window is in front" rule (hudWindows.cjs) count it too. Compare's frame since 1.3.0 (owner,
   * 2026-10-22: "the same style as Compare's"): no Windows caption, the tab strip is the bar, Windows' buttons drawn in
   * EDEXO's colours over it.
   */
  function openColonizeWindow(iconForChild) {
    const runtime = getRuntime();
    if (!runtime) return { opened: false, error: "Server not ready yet." };
    if (colonizeWindow && !colonizeWindow.isDestroyed()) {
      if (colonizeWindow.isMinimized()) colonizeWindow.restore();
      colonizeWindow.show();
      colonizeWindow.focus();
      return { opened: true, focused: true };
    }
    const base = runtime.getLocalBaseUrl();
    const saved = readWindowState("colonize");
    const area = screen.getPrimaryDisplay().workArea;
    const preloadPath = path.join(__dirname, "preload.cjs");
    const customTitleBar = process.platform === "win32";
    const win = new BrowserWindow({
      width: saved?.width ?? Math.min(1400, Math.round(area.width * 0.85)),
      height: saved?.height ?? Math.min(920, Math.round(area.height * 0.9)),
      ...(saved ? { x: saved.x, y: saved.y } : {}),
      minWidth: WINDOW_MIN.colonize.w,
      minHeight: WINDOW_MIN.colonize.h,
      backgroundColor: "#07060a",
      autoHideMenuBar: true,
      title: "EDEXO Colonize",
      icon: iconForChild,
      ...(customTitleBar
        ? { titleBarStyle: "hidden", titleBarOverlay: { color: "#07060a", symbolColor: "#f0a050", height: 34 } }
        : {}),
      webPreferences: {
        additionalArguments: customTitleBar ? ["--edexo-custom-titlebar"] : [],
        spellcheck: false,
        contextIsolation: true,
        nodeIntegration: false,
        partition: APP_WINDOW_PARTITION,
        preload: fs.existsSync(preloadPath) ? preloadPath : undefined,
      },
    });
    colonizeWindow = win;
    // Its tabs move to and from Compare's windows (owner, 2026-10-22).
    tabWindows.attachColonize(win);
    getDiag()?.watchWindow(win, "colonize");
    if (saved?.maximized) win.maximize();
    trackWindowState("colonize", win);
    enableZoom(win);
    attachAppPageLinks(win, base, iconForChild);
    win.on("closed", () => {
      if (colonizeWindow === win) colonizeWindow = null;
    });
    void win.loadURL(`${base}/?screen=colonize`);
    return { opened: true, focused: false };
  }

  return {
    openAppUiWindow,
    openColonizeWindow,
    closeAppWindow() {
      if (appUiWindow && !appUiWindow.isDestroyed()) appUiWindow.close();
    },
  };
}

module.exports = { APP_WINDOW_PARTITION, createAppWindows };
