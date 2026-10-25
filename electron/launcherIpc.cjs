"use strict";

/*
  What the launcher and the HUD pages ask the main process for (split out of main.cjs, discuss item 30, 1.3.1): the
  HUD windows and their layout, the app and Colonize windows, the tray, graphics and key bind settings, saving and
  picking files, and installing an update or restarting. The settings and file pickers answer the launcher only.
*/
const fs = require("fs");
const path = require("path");
const gpuSafe = require("./gpuSafeMode.cjs");
const { hudPathFrom, hudWidthFrom, hudHeightFrom } = require("./hudWindows.cjs");

function registerLauncherIpc(
  { electron, huds, appWindows, keybinds, trayControl, quitFlow, tray, graphics, gpuSafeDir, hotkey, getRuntime, getMainWindow },
  iconForChild,
) {
  const { app, dialog, ipcMain, BrowserWindow } = electron;
  const { closeToTray, setCloseToTray, trayAvailability } = tray;

  ipcMain.handle("edexo:foot-overlay-state", () => ({
    opened: huds.paths().length > 0,
    paths: huds.paths(),
  }));

  ipcMain.handle("edexo:hud-overlay-state", () => ({ paths: huds.paths() }));

  ipcMain.handle("edexo:open-app-window", () => appWindows.openAppUiWindow(iconForChild));
  ipcMain.handle("edexo:open-colonize-window", () => appWindows.openColonizeWindow(iconForChild));

  ipcMain.handle("edexo:get-tray-pref", () => ({ enabled: closeToTray(), ...trayAvailability() }));
  /*
    Hardware acceleration (gpuSafeMode.cjs): what this start runs with, what the next will, and why. A change counts
    from the next start; the launcher offers the restart. Launcher only, like the key binds.
  */
  const graphicsPref = () => {
    const flag = gpuSafe.readGpuSafe(gpuSafeDir);
    return {
      // This start.
      safeNow: graphics.safe,
      why: graphics.why,
      // The next start (the remembered mode; env and argv are outside the app's say).
      safeNext: graphics.why === "env" || graphics.why === "argv" ? true : !!flag,
      locked: graphics.why === "env" || graphics.why === "argv",
      auto: !!flag && flag.auto,
      reason: flag ? flag.reason : "",
    };
  };
  ipcMain.handle("edexo:get-graphics-pref", () => graphicsPref());
  ipcMain.handle("edexo:set-graphics-pref", (evt, opts) => {
    if (!getMainWindow() || evt.sender !== getMainWindow().webContents) return graphicsPref();
    const hardware = !!(opts && typeof opts === "object" && opts.hardware);
    if (hardware) gpuSafe.clearGpuSafe(gpuSafeDir);
    else gpuSafe.writeGpuSafe(gpuSafeDir, { auto: false, reason: "turned off in the launcher", at: new Date().toISOString() });
    return graphicsPref();
  });
  ipcMain.handle("edexo:set-tray-pref", (_evt, opts) => {
    setCloseToTray(!!(opts && typeof opts === "object" && opts.enabled));
    return { enabled: closeToTray(), ...trayAvailability() };
  });
  ipcMain.handle("edexo:hotkey-status", () => ({
    shortcut: keybinds.bindFor("hudToggle"),
    registered: hotkey.get(),
  }));
  ipcMain.handle("edexo:get-keybinds", () => keybinds.get());
  // Global keys are the launcher's to change (1.2.19 review): no other page, whatever it is, registers shortcuts.
  const fromLauncher = (evt) => !!getMainWindow() && !getMainWindow().isDestroyed() && evt.sender === getMainWindow().webContents;
  ipcMain.handle("edexo:pause-keybinds", (evt, opts) =>
    fromLauncher(evt) ? keybinds.pause(!!(opts && typeof opts === "object" && opts.on)) : keybinds.get(),
  );
  ipcMain.handle("edexo:set-keybinds", (evt, next) => {
    if (!fromLauncher(evt)) return keybinds.get();
    const r = keybinds.set(next && typeof next === "object" ? next : {});
    hotkey.set(keybinds.statusFor("hudToggle") === "ok");
    trayControl.refresh();
    return r;
  });

  ipcMain.handle("edexo:open-hud-overlay", async (_evt, opts) =>
    huds.request(hudPathFrom(opts), hudWidthFrom(opts), hudHeightFrom(opts), iconForChild, "open"),
  );

  ipcMain.handle("edexo:toggle-hud-overlay", async (_evt, opts) =>
    huds.request(hudPathFrom(opts), hudWidthFrom(opts), hudHeightFrom(opts), iconForChild, "toggle"),
  );

  /*
    The merged HUD. One window, its sections chosen by the query string; changing the sections is
    a `set` (the open window navigates) rather than a close-and-reopen, so it does not blink.
  */
  ipcMain.handle("edexo:set-hud-overlay", async (_evt, opts) =>
    huds.request(
      hudPathFrom(opts, "/hud-overlay.html"),
      hudWidthFrom(opts),
      hudHeightFrom(opts),
      iconForChild,
      "set",
    ),
  );

  ipcMain.handle("edexo:close-hud-overlay", async (_evt, opts) => {
    const o = opts && typeof opts === "object" ? opts : {};
    if (typeof o.pathname !== "string" || !o.pathname.trim()) {
      return { closed: false, paths: huds.paths() };
    }
    return huds.close(hudPathFrom(o));
  });

  ipcMain.handle("edexo:get-hud-layout", () => huds.layout());
  ipcMain.handle("edexo:set-hud-layout", (_evt, opts) =>
    huds.setLayout(opts && typeof opts === "object" ? opts : {}),
  );
  ipcMain.handle("edexo:toggle-hud-visibility", (_evt, opts) => {
    const o = opts && typeof opts === "object" ? opts : {};
    return { hidden: huds.toggleVisibility(typeof o.hidden === "boolean" ? o.hidden : undefined) };
  });

  /*
    Exomastery downloads (§S): a Save dialog rather than Chromium's download shelf, starting in
    Downloads with the name the server chose. Only the launcher may ask, and only for text.
  */
  ipcMain.handle("edexo:save-text-file", async (evt, opts) => {
    if (!getMainWindow() || evt.sender !== getMainWindow().webContents) return { saved: false, error: "Not allowed." };
    const text = opts && typeof opts.text === "string" ? opts.text : null;
    const rawName = opts && typeof opts.defaultName === "string" ? opts.defaultName : "EDEXO.json";
    const name = path.basename(rawName).replace(/[<>:"|?*]/g, "_") || "EDEXO.json";
    if (text == null) return { saved: false, error: "Nothing to save." };
    const r = await dialog.showSaveDialog(getMainWindow(), {
      title: "Save",
      defaultPath: path.join(app.getPath("downloads"), name),
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (r.canceled || !r.filePath) return { saved: false };
    try {
      fs.writeFileSync(r.filePath, text, "utf8");
      return { saved: true, path: r.filePath };
    } catch (e) {
      return { saved: false, error: e && e.message ? e.message : String(e) };
    }
  });

  /*
    Backups (owner, 2026-09-28): a folder picker for where they go and where journals are restored,
    and a restart that finishes a restore (it is applied at start, before anything reads the data).
    The portable exe runs from a temporary copy; relaunching that copy would start an exe the
    wrapper is about to delete, so the restart goes through the original file when there is one.
  */
  ipcMain.handle("edexo:pick-folder", async (evt, opts) => {
    if (!getMainWindow() || evt.sender !== getMainWindow().webContents) return { path: null };
    const start = opts && typeof opts.defaultPath === "string" && opts.defaultPath ? opts.defaultPath : app.getPath("documents");
    const r = await dialog.showOpenDialog(getMainWindow(), {
      title: "Choose a folder",
      defaultPath: start,
      properties: ["openDirectory", "createDirectory"],
    });
    return { path: r.canceled || !r.filePaths[0] ? null : r.filePaths[0] };
  });
  /*
    "Download & Install": the server has the newer release downloaded and checked; it goes in on the
    way out (will-quit), and the new copy starts. With a backup running, quitting asks first, and
    "Keep the app open" calls this off like a plain restart.
  */
  ipcMain.handle("edexo:install-update", async (evt) => {
    if (!getMainWindow() || evt.sender !== getMainWindow().webContents) return { ok: false };
    const staged = getRuntime() && typeof getRuntime().stagedUpdate === "function" ? await getRuntime().stagedUpdate().catch(() => null) : null;
    if (!quitFlow.selfUpdateForm() || !staged) return { ok: false, error: "No downloaded update is waiting." };
    quitFlow.armInstall(staged);
    app.quit();
    return { ok: true };
  });
  ipcMain.handle("edexo:relaunch", (evt) => {
    if (!getMainWindow() || evt.sender !== getMainWindow().webContents) return { ok: false };
    /*
      Armed here, registered in will-quit (combined plan 1.6c): with a backup running, quitting asks
      first, and "Keep the app open" used to leave the relaunch armed for the next ordinary quit.
    */
    quitFlow.armRelaunch();
    app.quit();
    return { ok: true };
  });

  // The launcher's HUD settings, forwarded to every overlay as they change (see preload `pushHudPrefs`).
  ipcMain.on("edexo:push-hud-prefs", (evt, prefs) => {
    if (!getMainWindow() || evt.sender !== getMainWindow().webContents) return;
    huds.pushPrefs(prefs);
  });

  // An overlay reporting how tall it actually is (hudWindows.cjs `resizeFromPage`).
  ipcMain.handle("edexo:resize-hud-overlay", (evt, opts) =>
    huds.resizeFromPage(BrowserWindow.fromWebContents(evt.sender), opts),
  );
  // Free move: the launcher starts and ends placing; a HUD page reports its drag (only HUD windows
  // in placing mode are listened to, see hudWindows.dragFromPage).
  ipcMain.handle("edexo:set-hud-move-mode", (_evt, opts) => ({
    moving: huds.setMoveMode(!!(opts && typeof opts === "object" && opts.on === true)),
  }));
  ipcMain.handle("edexo:hud-drag", (evt, opts) => {
    const phase = opts && typeof opts === "object" ? opts.phase : null;
    if (!["start", "move", "end", "done", "frame", "hover"].includes(phase)) return { ok: false };
    return huds.dragFromPage(BrowserWindow.fromWebContents(evt.sender), phase);
  });

  ipcMain.handle("edexo:toggle-foot-overlay", async () => {
    try {
      return await huds.request("/distance-overlay.html", 404, 330, iconForChild, "toggle");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { opened: false, paths: huds.paths(), error: msg };
    }
  });
}

module.exports = { registerLauncherIpc };
