/*
  Backups: where they go, how often, the list, and restoring app data or journals.
  Split out of public/launcher.js (discuss item 19, 1.3.1).
*/
import { apiUrl } from "./network.js";

/* ------------------------------------------------------------------------------ backups */
var backupModal = document.getElementById("backupModal");
var btnBackups = document.getElementById("btnBackups");
var backupSub = document.getElementById("backupSub");
var backupState = document.getElementById("backupState");
var backupErr = document.getElementById("backupErr");
var backupList = document.getElementById("backupList");
var backupFields = {
  onLeaveGame: document.getElementById("backupOnLeave"),
  everyHours: document.getElementById("backupEvery"),
  folder: document.getElementById("backupFolder"),
  keep: document.getElementById("backupKeep"),
  includeKeys: document.getElementById("backupKeys"),
  includeBioBodies: document.getElementById("backupBio"),
};
var backupPoll = null;
/** What each field holds now (checkbox: checked, else its text), to tell later whether it was edited. */
function backupFieldValues() {
  var out = {};
  Object.keys(backupFields).forEach(function (k) {
    var f = backupFields[k];
    out[k] = f.type === "checkbox" ? f.checked : f.value;
  });
  return out;
}
/** The last folder check ({level, against, …}), for the tile's line. */
var backupRiskLast = null;
/** From the last status: a folder was chosen (then saving keeps it). */
var backupFolderChosen = false;

function backupMb(bytes) {
  return bytes >= 1e9 ? (bytes / 1e9).toFixed(2) + " GB" : (bytes / 1e6).toFixed(1) + " MB";
}
function backupWhen(iso) {
  var d = new Date(iso);
  var mins = Math.round((Date.now() - d.getTime()) / 60000);
  var ago =
    mins < 1 ? "just now" : mins < 60 ? mins + " min ago" : mins < 2880 ? Math.round(mins / 60) + " h ago" : Math.round(mins / 1440) + " days ago";
  return d.toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) + " (" + ago + ")";
}
/** The outcome of a restore: its own line, so the status refresh does not overwrite it. */
function backupNote(msg) {
  var el = document.getElementById("backupMsg");
  if (!el) return;
  el.textContent = msg || "";
  el.hidden = !msg;
}
function backupShowErr(msg) {
  if (!backupErr) return;
  backupErr.textContent = msg || "";
  backupErr.style.display = msg ? "" : "none";
}
function backupJson(path, body) {
  return fetch(apiUrl(path), body === undefined ? undefined : {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then(function (r) {
    return r.json().then(function (j) {
      if (!r.ok || !j || j.ok === false) throw new Error((j && j.error) || r.statusText);
      return j;
    });
  });
}

/** The tile's line and, when the panel is open, its state and fields. */
/**
 * `fillFields`: write the saved settings back into the fields. `sent`: the field values a save sent;
 * then only fields still holding them are written, so what was typed meanwhile stays (2026-10-12: a
 * save's late answer put the suggested folder back over a folder typed after it, and "Use this
 * folder" then confirmed the suggestion).
 */
function backupRefresh(fillFields, sent) {
  return backupJson("/api/backup/status")
    .then(function (s) {
      var line;
      var tone = "";
      var risk = backupRiskLast && backupRiskLast.folder === s.folder ? backupRiskLast : null;
      var what = risk && risk.against === "app data" ? "the app's data" : "your journals";
      if (s.running) { line = "Backing up… — please don't close the app"; tone = "yellow"; }
      else if (s.lastError) { line = "Last backup failed — open for details"; tone = "red"; }
      else if (!s.folderChosen) { line = "Choose a backup folder to start automatic backups"; tone = "yellow"; }
      else if (risk && risk.level === "same-volume") { line = "Backups share a drive with " + what + " — a USB drive is safer"; tone = "red"; }
      else if (risk && risk.level === "same-disk") { line = "Same physical drive as " + what + " — a drive failure loses both"; tone = "yellow"; }
      else if (s.last) line = "Last: " + backupWhen(s.last.at) + " · " + backupMb(s.last.bytes);
      else line = "Not backed up yet — journals, your data and codex";
      if (backupSub) {
        backupSub.textContent = line;
        backupSub.className = "subline" + (tone ? " backup-sub--" + tone : "");
      }
      backupFolderChosen = !!s.folderChosen;
      var needs = document.getElementById("backupNeedsFolder");
      if (needs) needs.hidden = !!s.folderChosen;
      if (!risk || Date.now() - (backupRiskLast.at || 0) > 60000) backupCheckFolder(s.folder, true);
      if (backupState) {
        backupState.className = "backup-state" + (s.running ? " busy" : s.lastError ? " err" : "");
        var parts = [];
        if (s.running) parts.push("Backing up (" + (s.reason || "now") + ")…");
        else if (s.last) parts.push("Last backup " + backupWhen(s.last.at) + " · " + backupMb(s.last.bytes) + " · " + (s.last.kind === "full" ? "everything" : "new journals and your data"));
        else parts.push("No backup yet.");
        if (s.pendingAt) parts.push("The game has closed: a backup starts in about a minute.");
        if (!s.folderChosen) parts.push("Automatic backups start once you choose a folder.");
        if (s.lastError) parts.push("Problem: " + s.lastError.message);
        parts.push(s.count + " in " + s.folder);
        backupState.textContent = parts.join("  ·  ");
      }
      var restartRow = document.getElementById("backupRestartRow");
      if (restartRow) restartRow.hidden = !s.restorePending;
      var nowBtn = document.getElementById("backupNow");
      if (nowBtn) nowBtn.disabled = !!s.running;
      if (fillFields) {
        var now = backupFieldValues();
        var mine = function (k) { return !sent || now[k] === sent[k]; };
        if (mine("onLeaveGame")) backupFields.onLeaveGame.checked = !!s.settings.onLeaveGame;
        if (mine("everyHours")) backupFields.everyHours.value = String(s.settings.everyHours);
        if (mine("folder")) backupFields.folder.value = s.folder;
        if (mine("keep")) backupFields.keep.value = String(s.settings.keep);
        if (mine("includeKeys")) backupFields.includeKeys.checked = !!s.settings.includeKeys;
        if (mine("includeBioBodies")) backupFields.includeBioBodies.checked = !!s.settings.includeBioBodies;
        backupCheckFolder(backupFields.folder.value.trim() || s.folder);
      }
      return s;
    })
    .catch(function () {
      if (backupSub) backupSub.textContent = "Journals, your data and codex — kept as zips";
    });
}

function backupLoadList() {
  if (!backupList) return;
  backupJson("/api/backup/list")
    .then(function (j) {
      backupList.innerHTML = "";
      if (!j.backups.length) {
        var li = document.createElement("li");
        li.textContent = "No backups in this folder yet.";
        backupList.appendChild(li);
        return;
      }
      j.backups.forEach(function (b) {
        var li = document.createElement("li");
        var name = document.createElement("span");
        name.textContent = backupWhen(b.created) + " · " + backupMb(b.bytes);
        var meta = document.createElement("em");
        meta.textContent =
          (b.kind === "full" ? "All " + b.journals + " journal files" : b.journals + (b.journals === 1 ? " new journal file" : " new journal files") + " (needs the backup before it)") +
          ", " + b.appDataFiles + " app files" + (b.errors ? " · " + b.errors + " problem(s)" : "") + " — " + b.file;
        var actions = document.createElement("span");
        actions.className = "backup-actions";
        var ra = document.createElement("button");
        ra.type = "button";
        ra.className = "btn-mini";
        ra.textContent = "App data";
        ra.title = "Put this backup's app data back when the app next starts";
        ra.addEventListener("click", function () { backupRestoreAppData(b.file); });
        var rj = document.createElement("button");
        rj.type = "button";
        rj.className = "btn-mini";
        rj.textContent = "Journals";
        rj.title = "Write this backup's journals into a folder you choose";
        rj.addEventListener("click", function () { backupRestoreJournals(b.file); });
        actions.appendChild(ra);
        actions.appendChild(rj);
        li.appendChild(name);
        li.appendChild(actions);
        li.appendChild(meta);
        backupList.appendChild(li);
      });
    })
    .catch(function (e) { backupShowErr("Could not list the backups: " + (e && e.message ? e.message : e)); });
}

/** Red: same partition as the journals or app data. Yellow: same physical drive. */
function backupCheckFolder(folder, forTile) {
  var box = document.getElementById("backupRisk");
  if (!box) return;
  var q = folder ? "?folder=" + encodeURIComponent(folder) : "";
  backupJson("/api/backup/folder-check" + q)
    .then(function (r) {
      var had = backupRiskLast && backupRiskLast.folder === r.folder && backupRiskLast.level === r.level;
      r.at = Date.now();
      backupRiskLast = r;
      if (forTile && !had) backupRefresh(false);
      var what = r.against === "journals" ? "your journals" : "the app's data";
      var here = r.folderVolume ? " (" + r.folderVolume + ")" : "";
      var there = r.dataVolume ? " (" + r.dataVolume + ")" : "";
      var usb = r.usb ? " It is on a USB drive." : "";
      box.hidden = false;
      if (r.level === "same-volume") {
        box.className = "backup-risk backup-risk--red";
        box.innerHTML = "";
        var b = document.createElement("strong");
        b.textContent = "Same partition as " + what + there + ". ";
        box.appendChild(b);
        box.appendChild(document.createTextNode(
          "Backups here still bring back deleted or damaged files, but if the drive fails, is wiped or Windows is " +
          "reinstalled, they are lost together with the originals. Another drive, a USB drive or a synced folder is safer. " +
          "If this is the only drive you have, backing up here is still better than no backup."
        ));
      } else if (r.level === "same-disk") {
        box.className = "backup-risk backup-risk--yellow";
        box.innerHTML = "";
        var y = document.createElement("strong");
        y.textContent = "Same physical drive. ";
        box.appendChild(y);
        box.appendChild(document.createTextNode(
          "This folder" + here + " is on another partition of the drive that holds " + what + there + ". It survives a wiped " +
          "partition, but if the drive itself fails, the data and its backups are lost for good. Another drive or a USB drive is safer."
        ));
      } else if (r.level === "separate") {
        box.className = "backup-risk backup-risk--ok";
        box.textContent = r.network
          ? "A network folder: separate from your journals and the app's data."
          : "A separate drive from your journals and the app's data." + usb;
      } else {
        box.hidden = true;
      }
    })
    .catch(function () { box.hidden = true; });
}

/**
 * Save the panel. The folder counts as chosen only when the commander touched it (typed, Browse…,
 * Use this folder) or had chosen one before — ticking another box must not confirm the suggestion.
 */
function backupSave(confirmFolder) {
  backupShowErr("");
  var sent = backupFieldValues();
  var typed = backupFields.folder.value.trim();
  return backupJson("/api/backup/settings", {
    onLeaveGame: backupFields.onLeaveGame.checked,
    everyHours: Number(backupFields.everyHours.value),
    folder: typed && (confirmFolder === true || backupFolderChosen) ? typed : null,
    keep: Number(backupFields.keep.value),
    includeKeys: backupFields.includeKeys.checked,
    includeBioBodies: backupFields.includeBioBodies.checked,
  })
    .then(function () { return backupRefresh(true, sent); })
    .then(backupLoadList)
    .catch(function (e) { backupShowErr("Could not save: " + (e && e.message ? e.message : e)); });
}

function backupPickFolder(start) {
  var bridge = window.edexoElectron;
  if (bridge && typeof bridge.pickFolder === "function") {
    return bridge.pickFolder({ defaultPath: start || "" }).then(function (r) { return r && r.path ? r.path : null; });
  }
  var typed = window.prompt("Folder (full path):", start || "");
  return Promise.resolve(typed && typed.trim() ? typed.trim() : null);
}

function backupRestoreAppData(file) {
  if (!window.confirm(
    "Restore your app data from " + file + "?\n\nIt is put back the next time the app starts. Every file it replaces is moved into a before-restore folder, not deleted."
  )) return;
  backupShowErr("");
  backupJson("/api/backup/restore", { file: file, what: "app-data" })
    .then(function (r) {
      backupNote(r.staged + " files are ready. Restart the app to finish the restore.");
      return backupRefresh(false);
    })
    .catch(function (e) { backupShowErr("Could not restore: " + (e && e.message ? e.message : e)); });
}

function backupRestoreJournals(file) {
  backupPickFolder("").then(function (target) {
    if (!target) return;
    var send = function (allowGameFolder) {
      return backupJson("/api/backup/restore", { file: file, what: "journals", target: target, allowGameFolder: allowGameFolder });
    };
    backupShowErr("");
    send(false)
      .catch(function (e) {
        var msg = e && e.message ? e.message : String(e);
        if (/second confirmation/.test(msg) && window.confirm(
          "That is the game's own journal folder.\n\nFiles already there are never replaced — only missing journals are written. Restore into it anyway?"
        )) return send(true);
        throw e;
      })
      .then(function (r) {
        if (!r) return;
        backupNote(
          r.written + " journal files written to " + r.target + (r.skippedExisting ? "; " + r.skippedExisting + " were already there and were left alone." : "."),
        );
      })
      .catch(function (e) { backupShowErr("Could not restore the journals: " + (e && e.message ? e.message : e)); });
  });
}

/** What ran when the page loaded, in the order it ran (main.js calls each module's in the file's old order). */
export function start() {

  if (btnBackups && backupModal) {
    btnBackups.addEventListener("click", function () {
      backupShowErr("");
      backupNote("");
      backupModal.classList.add("on");
      backupRefresh(true);
      backupLoadList();
      if (backupPoll) clearInterval(backupPoll);
      backupPoll = setInterval(function () { backupRefresh(false); }, 3000);
    });
    var closeBackups = function () {
      backupModal.classList.remove("on");
      if (backupPoll) clearInterval(backupPoll);
      backupPoll = null;
    };
    document.getElementById("backupClose").addEventListener("click", closeBackups);
    backupModal.addEventListener("click", function (e) { if (e.target === backupModal) closeBackups(); });
    ["onLeaveGame", "everyHours", "keep", "includeKeys", "includeBioBodies"].forEach(function (k) {
      backupFields[k].addEventListener("change", function () { backupSave(false); });
    });
    backupFields.folder.addEventListener("change", function () { backupSave(true); });
    // Keeping the suggested folder is a choice too (one-drive PCs): confirm it as it stands.
    document.getElementById("backupUseFolder").addEventListener("click", function () {
      if (!backupFields.folder.value.trim()) return;
      backupSave(true);
    });
    document.getElementById("backupBrowse").addEventListener("click", function () {
      backupPickFolder(backupFields.folder.value).then(function (p) {
        if (!p) return;
        backupFields.folder.value = p;
        backupSave(true);
      });
    });
    document.getElementById("backupNow").addEventListener("click", function () {
      backupShowErr("");
      var p = backupJson("/api/backup/run", {});
      setTimeout(function () { backupRefresh(false); }, 150);
      p.then(function () { return backupRefresh(false); })
        .then(backupLoadList)
        .catch(function (e) { backupShowErr("Backup failed: " + (e && e.message ? e.message : e)); backupRefresh(false); });
    });
    document.getElementById("backupOpenFolder").addEventListener("click", function () {
      backupJson("/api/backup/open-folder", {}).catch(function (e) { backupShowErr(String(e && e.message ? e.message : e)); });
    });
    document.getElementById("backupRestart").addEventListener("click", function () {
      var bridge = window.edexoElectron;
      if (bridge && typeof bridge.relaunch === "function") bridge.relaunch();
      else backupShowErr("Close the app and start it again to finish the restore.");
    });
  }
  backupRefresh(false);
  setInterval(function () { if (!backupModal || !backupModal.classList.contains("on")) backupRefresh(false); }, 60000);
}
