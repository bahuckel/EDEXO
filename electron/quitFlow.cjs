"use strict";

/*
  The way out (split out of main.cjs, discuss item 30, 1.3.1): the backup hold, and a relaunch or an update install
  once the quit is really going ahead.

  Exit while a backup is being written (owner, 2026-09-29): a red warning, not a silent loss. The
  launcher's close and every other way out (tray Quit, the restart after a restore) pass through here.
  "Wait, then close" lets the backup finish and closes by itself; "Exit now" throws the backup away
  (its half-written file is cleared at the next start).
*/
const fs = require("fs");
const path = require("path");
const gpuSafe = require("./gpuSafeMode.cjs");
const updater = require("./updater.cjs");

function createQuitFlow({ app, dialog, getRuntime, getMainWindow }) {
  let exitAllowed = false;
  /** "Restart now" asked for a relaunch; done in will-quit, once the quit is really going ahead. */
  let relaunchOnQuit = false;
  /** "Download & Install" asked for this staged update to go in; installed in will-quit. */
  let installUpdateOnQuit = null;
  /** This copy's self-update form (updater.cjs), or null where it cannot replace itself. */
  let selfUpdateFormValue = null;

  /*
    Starts this copy again: the portable exe's own file, the AppImage itself (its running binary sits in a mount that
    goes with this process), or Electron's default. `extra` arguments are added (the GPU retry); the GPU retry of an
    earlier start is not carried on, or a later crash after "Hardware acceleration" is ticked again could not switch.
  */
  function relaunchAsUsual(extra = []) {
    const args = process.argv
      .slice(1)
      .filter((a) => a !== gpuSafe.GPU_RETRY_ARG)
      .concat(extra);
    const own =
      process.env.PORTABLE_EXECUTABLE_FILE ||
      (process.platform === "linux" && process.env.APPIMAGE ? process.env.APPIMAGE : null);
    app.relaunch(own ? { execPath: own, args } : { args });
  }

  app.on("will-quit", () => {
    if (installUpdateOnQuit) {
      const staged = installUpdateOnQuit;
      installUpdateOnQuit = null;
      try {
        // From the update folder, not resources: the portable stub deletes its unpacked copy on exit.
        const scriptPath = path.join(staged.dir, "update-apply.ps1");
        if (process.platform === "win32") {
          fs.copyFileSync(path.join(process.resourcesPath, "edexo", "update-apply.ps1"), scriptPath);
        }
        const r = updater.installOnQuit(staged, {
          form: selfUpdateFormValue,
          scriptPath,
          logPath: path.join(staged.dir, "update.log"),
          // The portable launcher stub waits for this process; its exe is the file being replaced.
          pids: [process.pid, selfUpdateFormValue === "portable" ? process.ppid : 0],
        });
        if (r.how === "relaunch") app.relaunch({ execPath: r.execPath, args: process.argv.slice(1) });
        else if (r.how === "none") relaunchAsUsual();
      } catch (e) {
        console.error("[edexo-compare] update install failed, restarting the installed copy:", e);
        relaunchAsUsual();
      }
      return;
    }
    if (!relaunchOnQuit) return;
    relaunchOnQuit = false;
    relaunchAsUsual();
  });
  let exitAsking = false;
  let exitWhenBackupDone = false;

  function holdExitForBackup(e) {
    const runtime = getRuntime();
    if (exitAllowed || !runtime || typeof runtime.backupRunning !== "function" || !runtime.backupRunning()) return false;
    e.preventDefault();
    if (exitAsking || exitWhenBackupDone) return true;
    exitAsking = true;
    const mainWindow = getMainWindow();
    const parent = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
    if (parent) {
      if (parent.isMinimized()) parent.restore();
      parent.show();
    }
    const opts = {
      type: "error",
      title: "Backup in progress",
      message: "A backup is being written right now.",
      detail:
        "If you exit now, this backup will be lost. Please wait — it usually takes a few seconds, and the app can close by itself when it is done.",
      buttons: ["Wait, then close", "Keep the app open", "Exit now — lose this backup"],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    };
    void (parent ? dialog.showMessageBox(parent, opts) : dialog.showMessageBox(opts)).then(({ response }) => {
      exitAsking = false;
      // "Keep the app open": a "Restart now" that started this quit is called off with it.
      if (response === 1) {
        relaunchOnQuit = false;
        installUpdateOnQuit = null;
      }
      if (response === 2) {
        exitAllowed = true;
        app.quit();
      } else if (response === 0) {
        exitWhenBackupDone = true;
        void runtime.whenBackupDone().then(() => {
          exitAllowed = true;
          app.quit();
        });
      }
    });
    return true;
  }

  return {
    relaunchAsUsual,
    holdExitForBackup,
    /** The next quit goes ahead without asking (the server stopped; there is nothing left to wait for). */
    allowExit() {
      exitAllowed = true;
    },
    /** "Restart now": relaunch once the quit is really going ahead. */
    armRelaunch() {
      relaunchOnQuit = true;
    },
    /** "Download & Install": this staged update goes in on the way out, and the new copy starts. */
    armInstall(staged) {
      installUpdateOnQuit = staged;
      relaunchOnQuit = false;
    },
    selfUpdateForm: () => selfUpdateFormValue,
    setSelfUpdateForm(form) {
      selfUpdateFormValue = form;
    },
  };
}

module.exports = { createQuitFlow };
