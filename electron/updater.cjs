"use strict";
/**
 * Installing a downloaded update on restart (owner, 2026-10-02: "instead of the user having to
 * download and replace it, integrate an updater, that requires an app restart to take effect").
 *
 * The server downloads the newer release and checks it against GitHub's SHA-256
 * (`src/server/appUpdater.ts`); this puts it in place when the commander presses "Download & Install".
 * A running program cannot replace itself on Windows, so on the way out a detached PowerShell
 * (`update-apply.ps1`) waits for this process and the portable launcher stub to end, swaps the file or
 * the folder, and starts the new copy — or the old one again if anything failed. An AppImage can be
 * replaced while it runs, so Linux renames the new image over the old one here and relaunches.
 *
 * Which copies can do this: a packaged build only. The portable exe (`PORTABLE_EXECUTABLE_FILE`), the
 * program folder from the zip (Windows), and the AppImage (`APPIMAGE`). A source run, macOS and the
 * console builds keep the release-page link.
 */
const { spawn } = require("node:child_process");
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const EXE_NAME = "EDExoCompare.exe";
/**
 * Every name this app's exe has or may have (1.3.0, the EDEXO rename): today's, first, and the one a later release
 * may switch to. A copy running under either can update itself, and the swap (update-apply.ps1) takes a zip holding
 * either, so the exe can be renamed in a release after 1.3.0 without stranding the copies that know only one name.
 * Copies before 1.3.0 know only EDExoCompare.exe: a release that renames the exe must still carry that file for them.
 */
const EXE_NAMES = [EXE_NAME, "EDEXO.exe"];
const isAppExe = (file) => EXE_NAMES.some((n) => n.toLowerCase() === path.basename(file).toLowerCase());

/**
 * "portable" | "zip" | "appimage" | null for this copy.
 * @param {{ isPackaged: boolean, platform?: string, env?: NodeJS.ProcessEnv, execPath?: string }} o
 */
function selfUpdateForm(o) {
  const env = o.env || process.env;
  const platform = o.platform || process.platform;
  if (!o.isPackaged) return null;
  if (platform === "win32") {
    if (env.PORTABLE_EXECUTABLE_FILE) return "portable";
    const exe = o.execPath || process.execPath;
    return isAppExe(exe) ? "zip" : null;
  }
  if (platform === "linux" && env.APPIMAGE) return "appimage";
  return null;
}

/** What the swap replaces: the user's exe, the program folder, or the AppImage. */
function updateTarget(form, env = process.env, execPath = process.execPath) {
  if (form === "portable") return env.PORTABLE_EXECUTABLE_FILE || null;
  if (form === "zip") return path.dirname(execPath);
  if (form === "appimage") return env.APPIMAGE || null;
  return null;
}

/*
  The program folder an update moves aside carries this file (review 2026-11-10, Electron 1): written into the running
  folder just before the swap, so it is in `<folder>.old` afterwards. Only a folder holding it is removed; a
  `<folder>.old` the commander made himself (a copy of the previous version) was deleted with everything in it.
*/
const MOVED_MARK = ".edexo-moved-aside";

/**
 * The copy the last update moved aside, removed at the next start: a program folder only when the update marked it
 * (MOVED_MARK), never a guess at someone else's folder. The mark left in the running folder by a swap that failed
 * and put it back goes too.
 */
function removeOldCopy(form, env = process.env, execPath = process.execPath) {
  const target = updateTarget(form, env, execPath);
  if (!target) return;
  const old = target + ".old";
  if (form === "zip") fs.rmSync(path.join(target, MOVED_MARK), { force: true });
  try {
    if (!fs.existsSync(old)) return;
    if (form === "zip") {
      if (!fs.existsSync(path.join(old, MOVED_MARK))) return;
      fs.rmSync(old, { recursive: true, force: true });
    } else {
      fs.rmSync(old, { force: true });
    }
  } catch {
    /* still in use (an explorer window, an antivirus scan); the next start tries again */
  }
}

/**
 * Start the swap on the way out. Call from will-quit with the staged update (`ready.json`).
 * Returns how the app comes back: "helper" (the PowerShell starts it), "relaunch" (Electron should
 * relaunch the given path), or "none" (nothing to install: relaunch as usual).
 * @param {{ form: string, file: string, version: string }} staged
 * @param {{ form: string, scriptPath: string, logPath: string, pids: number[], env?: NodeJS.ProcessEnv, execPath?: string, start?: boolean }} o
 */
function installOnQuit(staged, o) {
  const env = o.env || process.env;
  const target = updateTarget(o.form, env, o.execPath || process.execPath);
  if (!staged || staged.form !== o.form || !target || !fs.existsSync(staged.file)) return { how: "none" };
  /*
    Checked again on the way out (review 2026-11-10 D1): the hash was checked once, at download, and the install can
    be a later run; a file damaged or swapped since went in over the good copy. A folder at a drive root ("D:\") is
    refused: its trailing backslash swallows the closing quote of the helper's argument.
  */
  const refuse = (why) => {
    logFailure(o.logPath, why);
    return { how: "none", refused: why };
  };
  if (/[\\/]$/.test(target)) return refuse("a program folder at a drive root");
  if (typeof staged.sha256 !== "string" || sha256File(staged.file) !== staged.sha256.toLowerCase())
    return refuse("the downloaded file no longer matches its checksum");
  if (o.form === "appimage") {
    // Same folder, then a rename over the running image: atomic, and Linux lets a running file go.
    const next = target + ".new";
    try {
      fs.copyFileSync(staged.file, next);
      fs.chmodSync(next, 0o755);
      fs.renameSync(next, target);
    } catch (e) {
      fs.rmSync(next, { force: true });
      logFailure(o.logPath, e && e.message);
      throw e;
    }
    return { how: "relaunch", execPath: target };
  }
  // The swap clears what sits at <target>.old / <target>.new; one it did not make is renamed aside instead.
  if (o.form === "zip") {
    keepAsideUnlessOurs(target + ".old", (p) => fs.existsSync(path.join(p, MOVED_MARK)));
    keepAsideUnlessOurs(target + ".new", () => false);
    try {
      fs.writeFileSync(path.join(target, MOVED_MARK), `moved aside by the update to ${staged.version}\n`, "utf8");
    } catch {
      /* unmarked, the moved-aside copy stays for the commander to remove; the update still goes in */
    }
  }
  const args = [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-WindowStyle",
    "Hidden",
    "-File",
    o.scriptPath,
    "-WaitPids",
    o.pids.filter((p) => Number.isInteger(p) && p > 0).join(","),
    "-Mode",
    o.form,
    "-Target",
    target,
    "-Staged",
    staged.file,
    // The running copy's exe name: started again if the update fails, and preferred in the new zip.
    ...(o.form === "zip" ? ["-Exe", path.basename(o.execPath || process.execPath)] : []),
    "-Start",
    o.start === false ? "0" : "1",
    "-Log",
    o.logPath,
  ];
  /*
    Through `cmd /c start`: PowerShell 5.1 started straight from a detached process (no console) exits
    at once without running the script, and a child that is not detached is killed with this process
    (libuv puts it in a kill-on-close job). `start /b` hands it off and lets this process go.
    Every argument quoted: paths have spaces ("ED Exo Compare 1.2.9").
  */
  const line = "powershell.exe " + args.map((a) => `"${String(a).replace(/"/g, "")}"`).join(" ");
  const child = spawn(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", `start "" /b ${line}`], {
    // Never the app's own folder: a process working in a folder keeps Windows from renaming it, and
    // the folder swap would block itself (owner's .zip test, 2026-10-02).
    cwd: path.dirname(o.scriptPath),
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    windowsVerbatimArguments: true,
  });
  child.unref();
  return { how: "helper" };
}

/**
 * A failure in the swap's log, as update-apply.ps1 writes one, so the next start says why (appUpdater
 * lastInstallFailure; 5.1 §7: a failed Linux install wrote nothing).
 */
function logFailure(logPath, why) {
  try {
    if (logPath) fs.appendFileSync(logPath, `${new Date().toISOString()} update: FAILED, the old copy stays: ${why}\n`);
  } catch {
    /* the console has it */
  }
}

/** SHA-256 of a file, read in pieces (the zip is a few hundred MB). */
function sha256File(file) {
  const h = createHash("sha256");
  const buf = Buffer.allocUnsafe(1 << 20);
  const fd = fs.openSync(file, "r");
  try {
    let n;
    while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) h.update(buf.subarray(0, n));
  } finally {
    fs.closeSync(fd);
  }
  return h.digest("hex");
}

/** A folder at `p` that `ours` does not claim is renamed `<p>-kept-<time>`, never removed. */
function keepAsideUnlessOurs(p, ours) {
  if (!fs.existsSync(p) || ours(p)) return;
  fs.renameSync(p, `${p}-kept-${Date.now()}`);
}

module.exports = { selfUpdateForm, updateTarget, removeOldCopy, installOnQuit, sha256File, keepAsideUnlessOurs, EXE_NAME, EXE_NAMES, MOVED_MARK };
