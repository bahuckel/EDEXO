"use strict";

const {
  app,
  BrowserWindow,
  nativeImage,
  dialog,
  ipcMain,
  screen,
  globalShortcut,
  shell,
  clipboard,
  utilityProcess,
} = require("electron");
const { startServerChild } = require("./serverChild.cjs");
const { installStaticShell } = require("./staticShell.cjs");
const path = require("path");
const fs = require("fs");
const { writeFileAtomic } = require("./atomicWrite.cjs");
const gpuSafe = require("./gpuSafeMode.cjs");
const { createWindowState, enableZoom } = require("./windowState.cjs");
const {
  createHudWindows,
  hudPathFrom,
  hudWidthFrom,
  hudHeightFrom,
} = require("./hudWindows.cjs");
const { createTrayControl } = require("./tray.cjs");
const { createKeybinds } = require("./keybinds.cjs");
const { createTabWindows } = require("./tabWindows.cjs");
const updater = require("./updater.cjs");
const { watchForegroundOffMain, isGameOrOwn, isGame, nativeWatcherPath } = require("./foregroundWatch.cjs");
const { guardWindowNavigation, restrictPermissions, isOwnUrl } = require("./windowGuards.cjs");
const { APP_WINDOW_PARTITION, createAppWindows } = require("./appWindows.cjs");
const { createQuitFlow } = require("./quitFlow.cjs");
const { registerLauncherIpc } = require("./launcherIpc.cjs");

/*
  An isolated profile (`EDEXO_USER_DATA_DIR`) takes Electron's own directory with it (2026-10-17: an isolated
  copy still wrote the real app's %APPDATA%\edexo-compare — page caches, the windows' local storage, the
  browser's cookies). Set before anything reads it; the real profile is then neither written nor migrated from.
*/
if (process.env.EDEXO_USER_DATA_DIR) {
  app.setPath("userData", path.join(process.env.EDEXO_USER_DATA_DIR, "electron"));
}
/** The app's own origin once the server listens (windowGuards.cjs). */
const ownBase = () => (runtime ? runtime.getLocalBaseUrl() : null);
/** The foreground watcher (foregroundWatch.cjs), started a moment after the launcher. */
let foreground = null;
let foregroundStartTimer = null;
/** Was 5 s while PowerShell compiled its helper on every start; the native watcher (1.3.1) needs only the launcher drawn. */
const FOREGROUND_START_DELAY_MS = 1500;

/*
  Diagnostics, in the diagnostic build only (`npm run dist:win:diag`; owner, 2026-09-25). A public
  build does not pack `diag.cjs`, so the require fails and this stays null. See `diag.cjs`.
*/
let diag = null;
function startDiagnostics() {
  try {
    const outDir = path.join(
      process.env.EDEXO_USER_DATA_DIR ||
        path.join(process.env.LOCALAPPDATA || app.getPath("appData"), "ED Exo Compare"),
      "diag",
    );
    diag = require("./diag.cjs").start({ outDir });
  } catch (e) {
    if (!e || e.code !== "MODULE_NOT_FOUND") console.warn("[edexo-compare] diagnostics failed to start:", e);
    diag = null;
  }
}

/**
 * Some electron-builder targets report `app.isPackaged === false` even though resources are laid out
 * like a packaged app. Detect layout from disk so we load the right server bundle and env for `paths.ts`.
 */
function applyPackagedResourcesEnv() {
  const res = process.resourcesPath;
  if (!res) return;
  const bundle = path.join(res, "edexo", "app.cjs");
  const indexHtml = path.join(res, "web", "index.html");
  if (fs.existsSync(bundle) && fs.existsSync(indexHtml)) {
    process.env.EDEXO_ELECTRON_PACKAGED = "1";
    process.env.EDEXO_RESOURCES_ROOT = res;
  }
}

function serverBundlePath() {
  const res = process.resourcesPath;
  const fromResources = res ? path.join(res, "edexo", "app.cjs") : null;
  if (fromResources && fs.existsSync(fromResources)) {
    return fromResources;
  }
  return path.join(__dirname, "..", "build", "app.cjs");
}

function detectMode() {
  if (process.argv.includes("--local") || process.argv.includes("--client")) return "client";
  const base = path.basename(app.getPath("exe")).toLowerCase();
  if (base.includes("client") && !base.includes("server")) return "client";
  return "server";
}

let mainWindow = null;
let runtime = null;
/**
 * The overlay controls the server's HTTP routes reach (src/server/hudBridge.ts), asked for by message
 * from the server's process (serverChild.cjs). Empty until the windows exist; a call before then is
 * answered "not ready" rather than lost.
 */
let hudBridge = {};
let footOverlayIpcRegistered = false;

/** The HUD overlay windows: hudWindows.cjs owns the stack, its layout file and its visibility. */
const huds = createHudWindows({
  electron: { app, BrowserWindow, screen },
  getRuntime: () => runtime,
  getDiag: () => diag,
  preloadPath: path.join(__dirname, "preload.cjs"),
  guardWindow: (win) => guardWindowNavigation(win, ownBase, shell),
  onChange: () => {
    trayControl.refresh();
    // The launcher's Shown / Hidden buttons follow the hotkey and the tray as well as their own clicks.
    if (mainWindow && !mainWindow.isDestroyed()) {
      try {
        const l = huds.layout();
        mainWindow.webContents.send("edexo:hud-visibility", {
          hidden: huds.isHidden(),
          count: huds.count(),
          gameAway: l.gameAway,
          focusAway: l.focusAway && l.hideUnfocused,
          moving: l.moving,
        });
      } catch {
        /* the launcher reloading */
      }
    }
  },
});

function showLauncher() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

/*
  Key timing (owner, 2026-10-07): how long a body / screen tab key took to reach the page and be drawn,
  into hud-events.log — for the developer's own PC only. Key presses are not recorded for anyone else,
  even locally: it is on only where a file named `key-timing.on` sits beside the HUD layout.
*/
const keyTimingOn = () => {
  try {
    return fs.existsSync(path.join(path.dirname(huds.layoutPath()), "key-timing.on"));
  } catch {
    return false;
  }
};
/**
 * A key bind for the app pages: the app window by IPC (instant), browser tabs through the server's
 * socket — which the app window then ignores (useLiveSnapshot.ts), so nothing moves twice.
 */
function uiCommandEverywhere(cmd) {
  const timed = keyTimingOn();
  if (timed) huds.log(`key ${cmd.cmd} ${cmd.dir > 0 ? "next" : "previous"}`);
  const sent = timed ? { ...cmd, sentAt: Date.now() } : cmd;
  // Body tabs live in the app window; screen tabs step in the tab window used last (tabWindows.cjs).
  if (cmd.cmd === "screenTab") tabWindows.sendToFocused(sent);
  else tabWindows.sendToMain(sent);
  runtime?.uiCommand?.(cmd);
}
ipcMain.on("edexo:ui-ack", (_e, r) => {
  if (!r || typeof r !== "object" || !keyTimingOn()) return;
  huds.log(`key ${String(r.cmd)} in the page: got it +${Number(r.got)} ms, drawn +${Number(r.drawn)} ms`);
});

/*
  Key binds (owner, 2026-10-02): the HUD toggle and previous / next body tab, set in the launcher
  (electron/keybinds.cjs). The body keys go through the server to every app page.
*/
const keybinds = createKeybinds({
  globalShortcut,
  fs,
  filePath: () => path.join(path.dirname(huds.layoutPath()), "edexo-keybinds.json"),
  handlers: {
    hudToggle: () => huds.toggleVisibility(),
    bodyPrev: () => uiCommandEverywhere({ cmd: "bodyTab", dir: -1 }),
    bodyNext: () => uiCommandEverywhere({ cmd: "bodyTab", dir: 1 }),
    tabPrev: () => uiCommandEverywhere({ cmd: "screenTab", dir: -1 }),
    tabNext: () => uiCommandEverywhere({ cmd: "screenTab", dir: 1 }),
    // The server answers in its own process (serverChild.cjs); a key never waits for it.
    // F5 is also the browser's reload: a browsed page on screen gets it instead of the bell.
    noticesClear: () => {
      if (browserTabs?.reloadShown?.()) return;
      void runtime?.clearNotices?.()?.catch?.(() => {});
    },
    // Boxel scanning (server/boxelRun.ts): the server picks the system, the clipboard writer below copies it.
    boxelCopyNext: () => void runtime?.boxelCopyNext?.()?.catch?.(() => {}),
    boxelRun: () => {
      void Promise.resolve(runtime?.boxelRunToggle?.())
        .then((r) => {
          if (r) console.log(`[edexo-compare] boxel run ${r.running ? "started" : "finished"}: ${r.boxel}`);
        })
        .catch(() => {});
    },
    boxelPrev: () => void runtime?.boxelStep?.(-1)?.catch?.(() => {}),
    boxelNext: () => void runtime?.boxelStep?.(1)?.catch?.(() => {}),
  },
});

/** The tray (tray.cjs): the launcher, the HUD toggle, the UI in the browser, quit. */
const trayControl = createTrayControl({
  showLauncher,
  huds,
  getUiUrl: () => (runtime ? `${runtime.getLocalBaseUrl()}/` : null),
  hudShortcut: () => keybinds.bindFor("hudToggle"),
});

/*
  "App window" (owner, 2026-09-26): the exobiology UI in its own window.

  The launcher's old "This window" navigated the launcher itself to the app, so closing the app
  closed the launcher with it. This is a second window instead: close it and the launcher is still
  there. One at a time — asking again brings the open one forward.
*/
const { readWindowStates, readWindowState, trackWindowState, windowStatePath } = createWindowState(() =>
  path.dirname(huds.layoutPath()),
);

/** Tab view's detached windows (tabWindows.cjs): drag a tab out of the app window, or back in. */
const tabWindows = createTabWindows({
  BrowserWindow,
  ipcMain,
  baseUrl: () => (runtime ? runtime.getLocalBaseUrl() : null),
  preloadPath: fs.existsSync(path.join(__dirname, "preload.cjs")) ? path.join(__dirname, "preload.cjs") : undefined,
  partition: APP_WINDOW_PARTITION,
  icon: undefined,
  readWindowStates,
  readWindowState,
  writeWindowStates: (all) => {
    fs.mkdirSync(path.dirname(windowStatePath()), { recursive: true });
    writeFileAtomic(windowStatePath(), JSON.stringify(all, null, 2), "utf8");
  },
  trackWindowState,
  enableZoom,
  onExternalLink: (url) => void shell.openExternal(url),
});

/** The app, Colonize and galaxy map windows (appWindows.cjs). */
const appWindows = createAppWindows({
  electron: { BrowserWindow, screen, shell },
  getRuntime: () => runtime,
  getMainWindow: () => mainWindow,
  getDiag: () => diag,
  tabWindows,
  windowState: { readWindowStates, readWindowState, trackWindowState, windowStatePath },
  ownBase,
});

/*
  Close to tray (owner, 2026-10-01; was "Minimise to tray" from 2026-09-28): an option in the
  launcher, on Windows and Linux, remembered in window-state.json as `closeToTray`. A system with no
  tray (GNOME without the AppIndicator extension) greys it out: hiding the launcher there would leave
  nothing to bring it back with.

  The X hides the launcher in the tray, the way Discord does; minimise is always an ordinary minimise
  to the taskbar. A guild tester minimised the launcher, did not know what "the tray" was, and took
  the app for crashed; the minimise button that made a window vanish was the confusing part. Off
  unless the commander turns it on; the old `minimiseToTray` key meant something else and is ignored.
  Quitting goes through the tray menu (or any app.quit), which sets `appQuitting` first.
*/
let appQuitting = false;
/** Once per run: the first close to the tray says where the app went. */
let closeToTrayExplained = false;
let linuxTrayHost = null;
let hotkeyRegistered = null;

function trayAvailability() {
  if (!trayControl.exists()) return { available: false, reason: "This system has no tray." };
  if (process.platform === "linux" && linuxTrayHost === false) {
    return {
      available: false,
      reason: "Your desktop shows no tray icons (GNOME needs the AppIndicator extension).",
    };
  }
  return { available: true };
}

function closeToTray() {
  return readWindowStates().closeToTray === true;
}

function setCloseToTray(on) {
  try {
    const all = readWindowStates();
    all.closeToTray = on;
    fs.mkdirSync(path.dirname(windowStatePath()), { recursive: true });
    writeFileAtomic(windowStatePath(), JSON.stringify(all, null, 2), "utf8");
  } catch (e) {
    console.warn("[edexo-compare] could not save the tray setting:", e);
  }
}

/** The launcher's and the HUD pages' requests (launcherIpc.cjs), registered once. */
function registerFootOverlayIpc(iconForChild) {
  if (footOverlayIpcRegistered) return;
  footOverlayIpcRegistered = true;
  registerLauncherIpc(
    {
      electron: { app, dialog, ipcMain, BrowserWindow },
      huds,
      appWindows,
      keybinds,
      trayControl,
      quitFlow,
      tray: { closeToTray, setCloseToTray, trayAvailability },
      graphics,
      gpuSafeDir,
      hotkey: {
        get: () => hotkeyRegistered,
        set: (registered) => {
          hotkeyRegistered = registered;
        },
      },
      getRuntime: () => runtime,
      getMainWindow: () => mainWindow,
    },
    iconForChild,
  );
}

/** The server child's options, kept for a restart (per-commander profiles, 1.3.1). */
let serverOptions = null;
let switchingCommander = false;

/** What main listens to on the server's runtime; again after each restart. */
function wireRuntime() {
  // Boxel scanning: whatever the run, a jump or a boxel key picks goes on the clipboard.
  if (runtime && typeof runtime.onBoxelNext === "function") runtime.onBoxelNext((name) => clipboard.writeText(name));
  if (runtime && typeof runtime.onGameRunning === "function") {
    if (runtime.gameRunning() === false) huds.setGameAway(true);
    runtime.onGameRunning((running) => {
      console.log(`[edexo-compare] Elite ${running ? "running" : "not running"}: overlays ${running ? "back" : "hidden"}`);
      huds.setGameAway(!running);
    });
  }
}

/*
  Show another commander (per-commander profiles, 1.3.1): the server runs for one commander at a time, so it is
  stopped (it writes what it holds) and started again for this one, on the same address. The app's own windows load
  again, so nothing on screen is the other commander's; browser tabs wait for the new commander and reload themselves.
*/
async function restartServerFor(fid) {
  try {
    process.env.EDEXO_COMMANDER = fid;
    huds.log(`switching commander (${fid})`);
    await runtime.shutdown();
    runtime = await startServerChild(serverOptions);
    wireRuntime();
    for (const w of BrowserWindow.getAllWindows()) {
      if (w.isDestroyed()) continue;
      let url = "";
      try {
        url = w.webContents.getURL();
      } catch {
        continue;
      }
      if (isOwnUrl(url, ownBase)) w.webContents.reload();
    }
  } catch (e) {
    console.error("[edexo-compare] could not start the server for the other commander:", e);
    try {
      dialog.showErrorBox("EDEXO — switching commander failed", String(e && e.message ? e.message : e));
    } catch {
      /* ignore */
    }
  } finally {
    switchingCommander = false;
  }
}

async function start() {
  startDiagnostics();
  try {
    // Electron's userData is %APPDATA%\edexo-compare on Windows, while the dev server, the CLI and
    // every probe use %LOCALAPPDATA%\ED Exo Compare. Forcing this one made the packaged app keep a
    // second copy of everything — including the miss log the predictor is measured against, and a
    // 7.6 MB journal cache in a roaming profile. So: hand the old directory over to be migrated,
    // and let the server pick the single location the same way every other entry point does.
    const ud = app.getPath("userData");
    fs.mkdirSync(ud, { recursive: true });
    process.env.EDEXO_LEGACY_USER_DATA_DIR = ud;
  } catch (e) {
    console.error("[edexo-compare] Could not create Electron userData dir:", e);
  }

  applyPackagedResourcesEnv();

  /*
    Self-update (owner, 2026-10-02): only a packaged copy this file knows how to swap — the portable
    exe, the program folder, the AppImage (updater.cjs). The server downloads only when told so here.
    The copy the last update moved aside goes once this one has started (below).
  */
  quitFlow.setSelfUpdateForm(
    updater.selfUpdateForm({
      isPackaged: app.isPackaged || process.env.EDEXO_ELECTRON_PACKAGED === "1",
    }),
  );
  if (quitFlow.selfUpdateForm()) {
    process.env.EDEXO_SELF_UPDATE = "1";
  }

  const bundle = serverBundlePath();
  if (!fs.existsSync(bundle)) {
    const detail = [
      `Expected server bundle at:\n${bundle}`,
      `resourcesPath=${process.resourcesPath || "(empty)"}`,
      `app.isPackaged=${app.isPackaged}`,
      `__dirname=${__dirname}`,
    ].join("\n");
    try {
      dialog.showErrorBox("EDEXO — missing server bundle", detail);
    } catch {
      /* ignore */
    }
    app.exit(1);
    return;
  }

  process.env.EDEXO_SKIP_DEVENTRY_AUTOSTART = "1";

  /*
    Where the species tree lives, decided by the server's own discovery rather than a copy of it.

    This file used to carry its own version — portable `<exeDir>/data/species`, then
    `species-data-dir.json` in Electron's userData — and `paths.ts` carried the same walk against the
    directory everything else uses. Two implementations of one rule, and only the Electron one looked
    in a directory `EDEXO_USER_DATA_DIR` does not cover, so an isolated instance read the real
    profile's species tree.

    It must run before the server starts, because it works by setting `EDEXO_SPECIES_DATA_DIR`.
  */
  /*
    The server in a utility process of its own (owner, 2026-10-09: "I don't want to see the app in an
    unresponsive state"). It used to be required into this process, the one every window needs, so
    every long pass of the server froze them all; see src/server/serverChild.ts. The species-tree
    discovery above now runs there, before its server starts.
  */
  const mode = detectMode();
  /*
    Colonize's Inara folders (1.3.0): Windows' own Documents and Downloads, which can be moved and which the
    server's process cannot ask Electron for. A value already set (a test, a dev run) is kept.
  */
  for (const [env, kind] of [
    ["EDEXO_DOCUMENTS_DIR", "documents"],
    ["EDEXO_DOWNLOADS_DIR", "downloads"],
  ]) {
    if (process.env[env]) continue;
    try {
      process.env[env] = app.getPath(kind);
    } catch {
      /* the server falls back to the home folder's */
    }
  }
  serverOptions = {
    utilityProcess,
    bundle,
    mode,
    argv: process.argv,
    onHud: (method, arg) => {
      const fn = hudBridge[method];
      if (typeof fn !== "function") throw new Error(`Unknown HUD call: ${method}`);
      return fn(arg);
    },
    onDialog: (title, message) => {
      const opts = { type: "info", title, message };
      void (mainWindow && !mainWindow.isDestroyed() ? dialog.showMessageBox(mainWindow, opts) : dialog.showMessageBox(opts));
    },
    onUnexpectedExit: (code) => {
      console.error(`[edexo-compare] the server process ended (exit ${code})`);
      huds.log(`server process ended (exit ${code})`);
      try {
        dialog.showErrorBox(
          "EDEXO — the server stopped",
          `The part of the app that reads your journals stopped unexpectedly (exit ${code}). The app will close; start it again.`,
        );
      } catch {
        /* ignore */
      }
      quitFlow.allowExit();
      app.quit();
    },
  };
  runtime = await startServerChild(serverOptions);
  diag?.mark("server started");
  /*
    The pages' files from disk while the server's journal boot holds its thread (staticShell.cjs; owner,
    2026-10-19: the launcher still drew late and an early app window stayed blank). Off again a while after
    the boot, past the server's 20 s warm-up, so the API never runs through this process for the whole run.
  */
  if (runtime.webRoot() && runtime.contentSecurityPolicy()) {
    const { session } = require("electron");
    const staticShell = installStaticShell({
      sessions: [session.defaultSession, session.fromPartition(APP_WINDOW_PARTITION), session.fromPartition("persist:hud")],
      baseUrl: runtime.getLocalBaseUrl(),
      webRoot: runtime.webRoot(),
      csp: runtime.contentSecurityPolicy(),
      log: (m) => console.warn(`[edexo-compare] ${m}`),
    });
    void runtime.booted.then(() => {
      setTimeout(() => {
        staticShell.remove();
        diag?.mark(`static shell off (${staticShell.served()} file(s) served from disk)`);
      }, 30_000).unref?.();
    });
  }
  // Where the HUD layout lives and whether GNOME has a tray, as the server's process found them.
  huds.setLayoutPathResolver(() => runtime.layoutPath());
  if (process.platform === "linux") linuxTrayHost = runtime.linuxTrayHost();
  /*
    The copy the last update moved aside (EDExoCompare.exe.old, or the program folder's .old) goes once
    this one is up and serving (owner, 2026-10-02): every update would otherwise leave a few hundred MB
    behind for a commander who starts the app from a shortcut and never looks in the folder. Not
    before: if the new copy cannot start, the old one is still there to go back to.
  */
  const form = quitFlow.selfUpdateForm();
  if (form) {
    void runtime.ready.then(
      () => updater.removeOldCopy(form),
      () => {},
    );
  }

  const res = process.resourcesPath;
  let winIcon;
  /*
    The .ico first, the PNG as the fallback.

    Reported from the field: the taskbar button kept showing "the old icon" while the folder showed
    the new one. The artwork was never two different files -- `build/icon.ico` and this window icon
    are both built from `public/edexo-icon.png` -- but the two paths reach the screen differently.
    The exe's icon is an .ico, so Windows draws the 32px frame somebody drew at 32px. The window's
    was a 1024px PNG, which Electron downsamples to whatever the taskbar asks for, and a 1024 -> 24
    resample of a ringed logo loses the ring and reads as another mark entirely.

    Same art, sharp at the sizes Windows actually asks for.
  */
  const iconCandidates = [
    res && path.join(res, "edexo", "icon.ico"),
    path.join(__dirname, "..", "build", "icon.ico"),
    res && path.join(res, "edexo", "icon.png"),
    path.join(__dirname, "..", "public", "edexo-icon.png"),
  ].filter(Boolean);
  for (const p of iconCandidates) {
    try {
      if (fs.existsSync(p)) {
        const img = nativeImage.createFromPath(p);
        if (img && !img.isEmpty()) {
          winIcon = img;
          break;
        }
      }
    } catch {
      /* ignore */
    }
  }

  huds.setChildIcon(winIcon);
  registerFootOverlayIpc(winIcon);

  /*
    Hand the HTTP layer a way into these windows.

    The overlay controls were `ipcMain` channels only, which the app's own UI can invoke and nothing
    else can — so a console build, a phone, or a second terminal had no way to open a HUD. Registered
    here rather than passed into the server, because the server is already listening by the time
    these windows exist. See `src/server/hudBridge.ts`.
  */
  hudBridge = {
    state: () => ({ paths: huds.paths() }),
    open: (o) => huds.request(hudPathFrom(o), hudWidthFrom(o), hudHeightFrom(o), huds.childIcon(), "open"),
    toggle: (o) =>
      huds.request(hudPathFrom(o), hudWidthFrom(o), hudHeightFrom(o), huds.childIcon(), "toggle"),
    set: (o) =>
      huds.request(
        hudPathFrom(o, "/hud-overlay.html"),
        hudWidthFrom(o),
        hudHeightFrom(o),
        huds.childIcon(),
        "set",
      ),
    close: (o) => huds.close(hudPathFrom(o)),
    getLayout: () => huds.layout(),
    setLayout: (o) => huds.setLayout(o || {}),
    toggleVisibility: (o) => ({
      hidden: huds.toggleVisibility(o && typeof o.hidden === "boolean" ? o.hidden : undefined),
    }),
    // Per-commander profiles (1.3.1): answered now, the restart a moment later so the server's reply still goes out.
    switchCommander: (o) => {
      const fid = o && typeof o.fid === "string" ? o.fid : "";
      if (!fid) return { ok: false, error: "No commander given." };
      if (switchingCommander) return { ok: false, error: "Already switching." };
      switchingCommander = true;
      setTimeout(() => void restartServerFor(fid), 300);
      return { ok: true };
    },
  };

  huds.loadLayout();
  huds.watchDisplays();
  keybinds.load();
  const kbStatus = keybinds.apply();
  hotkeyRegistered = kbStatus.hudToggle === "ok";
  for (const [k, st] of Object.entries(kbStatus)) {
    if (st === "taken") console.warn("[edexo-compare] could not register", keybinds.bindFor(k), `(${k}; taken by another app)`);
  }

  const preloadPath = path.join(__dirname, "preload.cjs");
  const url = `${runtime.getLocalBaseUrl()}/launcher.html`;

  const launcherSaved = readWindowState("launcher");
  // First run (no saved size): as tall as the screen allows, within reason, instead of a fixed 768 px
  // that left most of a 1440p screen empty and put the page behind a scrollbar (tester, 2026-09-30).
  const launcherArea = screen.getPrimaryDisplay().workArea;
  const launcherDefaultH = Math.max(768, Math.min(1000, launcherArea.height - 80));
  // A saved 548 × 768 is the old default nobody chose: treat it as "never resized".
  const launcherUntouched = !launcherSaved || (launcherSaved.width === 548 && launcherSaved.height === 768);
  mainWindow = new BrowserWindow({
    width: launcherSaved?.width ?? 548,
    height: launcherUntouched ? launcherDefaultH : launcherSaved.height,
    ...(launcherSaved
      ? {
          x: launcherSaved.x,
          // Taller than it was saved: keep its bottom on the screen.
          y: launcherUntouched
            ? Math.max(
                launcherArea.y,
                Math.min(launcherSaved.y, launcherArea.y + launcherArea.height - launcherDefaultH),
              )
            : launcherSaved.y,
        }
      : {}),
    backgroundColor: "#050507",
    autoHideMenuBar: true,
    icon: winIcon,
    webPreferences: {
      // No spell-check: Electron can fetch its dictionaries from Google (owner, 2026-09-29).
      spellcheck: false,
      contextIsolation: true,
      nodeIntegration: false,
      preload: fs.existsSync(preloadPath) ? preloadPath : undefined,
    },
  });
  diag?.watchWindow(mainWindow, "launcher");
  guardWindowNavigation(mainWindow, ownBase, shell);
  if (launcherSaved?.maximized) mainWindow.maximize();
  trackWindowState("launcher", mainWindow);
  enableZoom(mainWindow);
  mainWindow.loadURL(url);
  trayControl.create(winIcon);
  // Overlays step aside while Elite is not running and come back with it (server gamePresence.ts;
  // guild tester report, 2026-09-30). The hotkey still shows them on demand.
  wireRuntime();
  /*
    ...and while it runs but another program is in front (owner, 2026-09-30). A short wait before
    hiding, so alt-tabbing past something does not flicker them; back at once with the game. This
    app's own windows count as the game's side: the app on a second screen keeps the overlays.
  */
  /*
    Started a moment in (discuss item 18, owner 2026-10-23): it was five seconds while the watcher compiled its C#
    helper on every start (PowerShell Add-Type), which competed with the launcher's first paint; the native watcher
    (1.3.1) has nothing to compile. Until then the overlays behave as before the game is seen in front: shown, keys
    not narrowed.
  */
  foregroundStartTimer = setTimeout(() => {
    foregroundStartTimer = null;
    if (appQuitting) return;
    const own = [path.basename(process.execPath, ".exe").toLowerCase(), "electron"];
    let hideTimer = null;
    const watcherExe = nativeWatcherPath(process.resourcesPath);
    huds.log(`foreground watcher: ${watcherExe ? "native" : "PowerShell (native helper not built)"}`);
    foreground = watchForegroundOffMain(utilityProcess, path.join(__dirname, "foregroundHost.cjs"), (name, at) => {
      huds.log(`foreground ${name || "(unreadable)"}${at ? ` at ${at.x},${at.y}` : ""}`);
      // The body tabs and Clear the notices take their keys only while Elite or this app (the app
      // window, the launcher; owner, 2026-10-07) is in front (keybinds.cjs); every other program keeps
      // them. "Idle" (no window for a moment between two) and an unreadable name change nothing.
      if (name && String(name).toLowerCase() !== "idle") keybinds.setGameFocused(isGameOrOwn(name, own));
      // The game in front: its monitor is where the corner stack goes (hudWindows setGamePoint).
      if (isGame(name) && at) huds.setGamePoint(at);
      // The game just came to the front (the watcher reports changes only): put the HUDs back on top.
      if (isGame(name)) huds.raiseVisible();
      if (isGameOrOwn(name, own)) {
        if (hideTimer) clearTimeout(hideTimer);
        hideTimer = null;
        huds.setFocusAway(false);
        return;
      }
      if (hideTimer) return;
      hideTimer = setTimeout(() => {
        hideTimer = null;
        huds.setFocusAway(true);
      }, 1500);
    }, watcherExe);
  }, FOREGROUND_START_DELAY_MS);
  /*
    The HUD windows come back once the launcher has drawn (discuss item 17): restored in the same first second they
    made the launcher's first paint wait. A launcher that never finishes loading still gets them after a few seconds.
  */
  {
    let restored = false;
    const restoreHuds = () => {
      if (restored) return;
      restored = true;
      void huds.restore(winIcon);
    };
    mainWindow.webContents.once("did-finish-load", () => setTimeout(restoreHuds, 250));
    setTimeout(restoreHuds, 5000);
  }
  mainWindow.on("close", (e) => {
    // With "Close to tray" on (and a tray to come back from), the X hides the launcher in the tray;
    // the server, the HUDs and the app window carry on. Quitting (tray menu) closes it for real.
    if (!appQuitting && closeToTray() && trayAvailability().available) {
      e.preventDefault();
      mainWindow.hide();
      if (!closeToTrayExplained) {
        closeToTrayExplained = true;
        trayControl.notify(
          "EDEXO is still running",
          "It is in the tray (the arrow next to the clock). Click its icon to bring the launcher back, or right-click it to quit.",
        );
      }
      return;
    }
    // A backup being written would be thrown away (owner, 2026-09-29): ask first.
    if (quitFlow.holdExitForBackup(e)) return;
    huds.dispose();
    trayControl.destroy();
    // The launcher is still the app: closing it closes the app window too, as it always quit — and every other
    // window (galaxy map, privacy page, torn-off tabs): one left open kept the app alive with no launcher and no tray,
    // holding the single-instance lock so the next start did nothing (1.2.19 review).
    appWindows.closeAppWindow();
    for (const w of BrowserWindow.getAllWindows()) if (w !== mainWindow && !w.isDestroyed()) w.close();
  });
  /*
    Windows logoff or shutdown ends the app without before-quit (combined plan 1.6d), so the clean
    shutdown never ran and the on-foot catalog's last second was lost. Flush what is buffered now.
  */
  mainWindow.on("session-end", () => {
    try {
      if (runtime && typeof runtime.flushNow === "function") runtime.flushNow();
    } catch {
      /* the session is ending either way */
    }
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

/*
  Linux: run under XWayland (docs/linux-plan-28092026.md). Electron 38+ starts as a native Wayland
  client on a Wayland desktop, and Wayland lets no app place its windows or keep them above another —
  the HUD stack would pile up wherever the compositor likes, under the game. Under XWayland both work,
  and so does the global hotkey while Elite (itself an XWayland window under Proton) has focus.
  Only when an X display exists: forced onto X11 without one, Electron would not start at all, and
  the start-up check explains what is missing instead.
*/
if (
  process.platform === "linux" &&
  process.env.DISPLAY &&
  !process.argv.some((a) => a.startsWith("--ozone-platform"))
) {
  app.commandLine.appendSwitch("ozone-platform", "x11");
}

/*
  Safe graphics mode (gpuSafeMode.cjs; L1, Linux ticket 2026-10-23: a hybrid NVIDIA laptop on Wayland lost the GPU
  process at start and the app with it, and ran with --disable-gpu --disable-gpu-sandbox). Read before `ready`,
  where these switches still count: the remembered mode, EDEXO_SAFE_GRAPHICS=1, or the commander's own flag.
*/
const appStartedAt = Date.now();
const gpuSafeDir = app.getPath("userData");
const graphics = gpuSafe.graphicsMode({
  env: process.env,
  argv: process.argv,
  flag: gpuSafe.readGpuSafe(gpuSafeDir),
});
if (graphics.addSwitches) {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch("disable-gpu");
  app.commandLine.appendSwitch("disable-gpu-sandbox");
}

/*
  The app's pages keep their normal process priority while another program (the game) is in front
  (owner, 2026-10-07: tab keys took 2-3 s in game). Chromium otherwise lowers a background
  renderer's priority, and next to a game at full load that is seconds per redraw.
*/
app.commandLine.appendSwitch("disable-renderer-backgrounding");

/**
 * Tell Windows who this application is, before any window exists.
 *
 * The taskbar keys a button's identity — its grouping, its pin, and the icon it draws — on the
 * Application User Model ID, not on the exe path. Without this call Electron leaves the default,
 * which for a portable build is derived from the running process, so Windows can hold an icon
 * association from an older run and redraw it over a window whose own icon has since changed. That
 * is the taskbar half of the icon report; the .ico above is the other half.
 *
 * `com.edexo.compare` is the same id `electron-builder.cjs` publishes as `appId`, deliberately: two
 * different ids would make the packaged app and the dev run two different applications to the shell.
 */
if (process.platform === "win32") {
  try {
    app.setAppUserModelId("com.edexo.compare");
  } catch (e) {
    console.warn("[edexo-compare] could not set the app user model id:", e);
  }
}

/*
  One copy (owner, 2026-10-01). A tester's launcher was hidden in the tray; starting the app again
  ran a second copy that never showed a window. Now a second start hands over to the running copy,
  which brings its launcher back — from the tray, from the taskbar, or from behind other windows —
  and the second copy quits.

  A deliberate second copy still works: `--port` (the documented way to run one beside another) or
  an isolated profile (`EDEXO_USER_DATA_DIR`) skip the lock.
*/
const separateCopy = process.argv.includes("--port") || !!process.env.EDEXO_USER_DATA_DIR;
let gotSingleInstanceLock = true;
if (!separateCopy) {
  gotSingleInstanceLock = app.requestSingleInstanceLock();
  if (!gotSingleInstanceLock) {
    // exit, not quit: this copy has nothing to close, and before-quit is the running copy's business.
    app.exit(0);
  } else {
    app.on("second-instance", () => {
      // Still starting (no launcher yet): it shows itself when it is made.
      showLauncher();
    });
  }
}

/*
  A GPU or page process that goes and comes back repaints its windows white for a moment (owner,
  2026-10-07: one white flash with Tab view on, at the first bio planet of a system, not seen again).
  Written to hud-events.log beside the HUD layout, so the next one says which process it was.
*/
app.on("child-process-gone", (_e, d) => {
  huds.log(`process gone: ${d && d.type} (${d && d.reason}${d && d.exitCode != null ? `, exit ${d.exitCode}` : ""})`);
  /*
    The GPU process gone at start on Linux (the ticket's exit 139): remember safe graphics mode and start again
    once without the GPU, before the X connection takes the rest down. The retry argument stops a loop; the
    launcher shows why the mode is on and can turn it off.
  */
  if (
    gpuSafe.shouldSwitchToSafe({
      platform: process.platform,
      details: d,
      sinceStartMs: Date.now() - appStartedAt,
      safe: graphics.safe,
      argv: process.argv,
    })
  ) {
    const reason = `GPU process ${d.reason}${d.exitCode != null ? ` (exit ${d.exitCode})` : ""} at start`;
    gpuSafe.writeGpuSafe(gpuSafeDir, { auto: true, reason, at: new Date().toISOString() });
    huds.log(`safe graphics mode on: ${reason}; starting again without the GPU`);
    quitFlow.relaunchAsUsual([gpuSafe.GPU_RETRY_ARG]);
    app.exit(0);
  }
});
/*
  A browsed page asking for a client certificate gets none (review 1.2.16: Electron's default sends the first one
  in the Windows store, which can carry a name or an e-mail address).
*/
app.on("select-client-certificate", (e, wc, _url, _list, callback) => {
  if (browserTabs?.isBrowserContents(wc)) {
    e.preventDefault();
    callback();
  }
});
app.on("render-process-gone", (_e, wc, d) => {
  // A browsed page's address is not written down: the browser keeps no history (review 1.2.16).
  if (browserTabs?.isBrowserContents(wc)) {
    huds.log(`page gone: a browser page (${d && d.reason})`);
    return;
  }
  huds.log(`page gone: ${wc && !wc.isDestroyed() ? wc.getURL().replace(/^https?:\/\/[^/]+/, "") : "?"} (${d && d.reason})`);
});

/*
  The EDEXO browser (plan 9, browserTabs.cjs): made at the first call from the Browser tab, so a run that never
  opens it loads nothing of it — its modules too (audit 2026-10-22: ~100 kB were required at every start).
*/
let browserTabs = null;
function getBrowserTabs() {
  if (browserTabs) return browserTabs;
  const { session, net, safeStorage } = require("electron");
  const { createBrowserPrefs } = require("./browserPrefs.cjs");
  const { createBrowserBlocker } = require("./browserBlocker.cjs");
  const { createBrowserTabs } = require("./browserTabs.cjs");
  const { createBrowserPasswords } = require("./browserPasswords.cjs");
  const dir = path.dirname(huds.layoutPath());
  const appSession = session.fromPartition(APP_WINDOW_PARTITION);
  const blocker = createBrowserBlocker({
    dir,
    bundlePath: app.isPackaged
      ? path.join(process.resourcesPath, "edexo", "browser-adblock.cjs")
      : path.join(__dirname, "..", "build", "browser-adblock.cjs"),
    fetch: (url) => net.fetch(url, { cache: "no-store" }),
    onChange: () => browserTabs?.changed?.(),
  });
  browserTabs = createBrowserTabs({
    electron: require("electron"),
    prefs: createBrowserPrefs({ dir }),
    // "Remember passwords": encrypted by the operating system (safeStorage), in browser/passwords.json.
    passwords: createBrowserPasswords({ dir, safeStorage }),
    blocker,
    // The app window and the windows tabs were dragged into: the app's session, the app's own page.
    isAppWindow: (wc) => wc.session === appSession && isOwnUrl(wc.getURL(), ownBase),
    enableZoom,
    log: (m) => huds.log(m),
  });
  return browserTabs;
}

app.whenReady().then(() => {
  if (!gotSingleInstanceLock) return;
  ipcMain.handle("edexo:browser", (e, msg) => getBrowserTabs().handle(e, msg));
  // Every session the windows use: the launcher's, the app window's, the HUDs' (windowGuards.cjs).
  try {
    const { session } = require("electron");
    for (const ses of [session.defaultSession, session.fromPartition(APP_WINDOW_PARTITION), session.fromPartition("persist:hud")]) {
      restrictPermissions(ses);
    }
  } catch (e) {
    console.warn("[edexo-compare] could not restrict permissions:", e);
  }
  void start().catch((e) => {
    console.error(e);
    try {
      let msg = e instanceof Error ? e.message : String(e);
      if (/EADDRINUSE|already in use/i.test(msg)) {
        /*
          Name the port that is actually taken. It was hard-coded at 7111, which was true for as
          long as --port was being ignored; now that the flag works, a commander who moved the port
          and hit a clash would be sent to look at the wrong one.
        */
        const i = process.argv.indexOf("--port");
        const port = i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : "7111";
        msg +=
          `\n\nPort ${port} is in use — often EDExoCompare-*-CLI.exe or another copy of this app. ` +
          `Close that copy, or start this one on a different port with --port <number>.`;
      }
      dialog.showErrorBox("EDEXO — startup failed", msg);
    } catch {
      /* ignore */
    }
    app.exit(1);
  });
});

app.on("window-all-closed", () => {
  app.quit();
});

// Quitting: the backup hold, a relaunch or an update install on the way out (quitFlow.cjs).
const quitFlow = createQuitFlow({ app, dialog, getRuntime: () => runtime, getMainWindow: () => mainWindow });

/** The server's process has stopped (or was given its few seconds); the quit can go ahead. */
let serverStopped = false;
let serverStopping = false;

app.on("before-quit", (e) => {
  if (quitFlow.holdExitForBackup(e)) return;
  browserTabs?.clearOnQuit();
  /*
    Let the server write what it holds and stop, in its own process, before this one goes (it used to
    be asked and not waited for). serverChild.cjs gives it a few seconds, then ends it.
  */
  if (runtime && !serverStopped) {
    e.preventDefault();
    if (serverStopping) return;
    serverStopping = true;
    closeForQuit();
    void runtime.shutdown().finally(() => {
      serverStopped = true;
      app.quit();
    });
    return;
  }
  closeForQuit();
});

let closedForQuit = false;
function closeForQuit() {
  if (closedForQuit) return;
  closedForQuit = true;
  // From here the launcher's X closes it for real, whatever "Close to tray" says.
  appQuitting = true;
  // Quitting closes every window: the detached tab windows stay listed for the next start.
  tabWindows.freeze();
  diag?.stop("quit");
  try {
    globalShortcut.unregisterAll();
  } catch {
    /* ignore */
  }
  huds.dispose();
  if (foregroundStartTimer) clearTimeout(foregroundStartTimer);
  foreground?.stop();
  trayControl.destroy();
}
