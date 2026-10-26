/*
  Imports: a Spansh export (the feeder's build-side tool) and the systems visited from another commander's or tool's list.
  Split out of public/launcher.js (discuss item 19, 1.3.1).
*/
import { apiUrl } from "./network.js";

/* ------------------------------------------------------------------ import Spansh export */
var importModal = document.getElementById("importModal");
var btnImportDump = document.getElementById("btnImportDump");
var importClose = document.getElementById("importClose");
var importStart = document.getElementById("importStart");
var importFile = document.getElementById("importFile");
var importApply = document.getElementById("importApply");
var importStatus = document.getElementById("importStatus");
var importNewer = document.getElementById("importNewer");
var importNewerText = document.getElementById("importNewerText");
var importNewerGo = document.getElementById("importNewerGo");
var LS_IMPORT_FILE = "edexo.launcher.importFile";
function rememberedImportFile() {
  try { return localStorage.getItem(LS_IMPORT_FILE) || ""; } catch (e) { return ""; }
}
/* The "newer export on disk" chip (owner, 2026-09-13): mtime moved since the last import of that file. */
function renderImportNewer(st) {
  var show = !!(st && st.newerOnDisk && !st.running);
  if (importNewer) importNewer.hidden = !show;
  if (btnImportDump) btnImportDump.classList.toggle("btn--attn", show);
  // The item sits in a closed menu: the menu's arrow carries the glow where it can be seen.
  var exoArrow = document.getElementById("btnExomasteryMenu");
  if (exoArrow) {
    exoArrow.classList.toggle("btn--attn", show);
    exoArrow.title = show ? "A newer Spansh export is on disk — Import Spansh export" : "";
  }
  if (show && importNewerText) {
    var when = st.fileMtimeIso ? new Date(st.fileMtimeIso).toLocaleString() : "";
    importNewerText.textContent = "Newer export on disk" + (when ? " (" + when + ")" : "") + " — last imported " + (st.lastImport && st.lastImport.finishedAt ? new Date(st.lastImport.finishedAt).toLocaleString() : "before") + ".";
  }
}
function startImport(file, apply) {
  if (importStart) importStart.disabled = true;
  return fetch(apiUrl("/api/feeder/import-dump"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file: file, apply: !!apply }),
  })
    .then(function (r) { return r.json().then(function (j) { return { r: r, j: j }; }); })
    .then(function (x) {
      if (!x.r.ok || !x.j.ok) throw new Error((x.j && x.j.error) || x.r.statusText);
      showImportStatus("Started…", "");
      if (!importPollTimer) pollImport();
    })
    .catch(function (e) {
      if (importStart) importStart.disabled = false;
      showImportStatus(String(e && e.message ? e.message : e), "err");
    });
}
var importPollTimer = null;
function showImportStatus(text, cls) {
  if (!importStatus) return;
  importStatus.hidden = false;
  importStatus.className = "import-status" + (cls ? " " + cls : "");
  importStatus.textContent = text;
}
function renderImportStatus(st) {
  if (!st) return;
  if (st.running) {
    showImportStatus("Running since " + (st.startedAt || "?") + "\n" + (st.file || ""), "");
    if (importStart) importStart.disabled = true;
    return;
  }
  if (importStart) importStart.disabled = false;
  if (st.error) showImportStatus("Failed: " + st.error, "err");
  else if (st.report) showImportStatus(st.report, st.failures > 0 ? "err" : "ok");
  else if (importStatus) importStatus.hidden = true;
}
function pollImport() {
  var remembered = rememberedImportFile();
  fetch(apiUrl("/api/feeder/import-dump/status" + (remembered ? "?file=" + encodeURIComponent(remembered) : "")), { cache: "no-store" })
    .then(function (r) { return r.json(); })
    .then(function (st) {
      renderImportStatus(st);
      renderImportNewer(st);
      if (st && st.running) importPollTimer = setTimeout(pollImport, 2000);
      else importPollTimer = null;
    })
    .catch(function () { importPollTimer = null; });
}
/* ------------------------------------------------------------------ import visited systems (plan 6.1) */
var visitedModal = document.getElementById("visitedModal");
var btnImportVisited = document.getElementById("btnImportVisited");
var visitedList = document.getElementById("visitedList");
var visitedImported = document.getElementById("visitedImported");
var visitedStatus = document.getElementById("visitedStatus");
var visitedRemove = document.getElementById("visitedRemove");
var visitedClose = document.getElementById("visitedClose");
function visitedSay(text, kind) {
  if (!visitedStatus) return;
  visitedStatus.hidden = !text;
  visitedStatus.className = "import-status" + (kind ? " " + kind : "");
  visitedStatus.textContent = text || "";
}
function visitedDate(iso) {
  return iso ? new Date(iso).toLocaleString() : "";
}
function visitedRender(j) {
  var imp = j && j.imported;
  visitedImported.hidden = !imp;
  visitedImported.className = "import-status ok";
  visitedImported.textContent = imp
    ? "Imported: " + imp.systems.toLocaleString() + " systems from account " + imp.account + " (the game's list of " +
      visitedDate(imp.fileModifiedAt) + "), on " + visitedDate(imp.importedAt) + "."
    : "";
  visitedRemove.hidden = !imp;
  visitedList.textContent = "";
  var files = (j && j.files) || [];
  if (!files.length) {
    visitedSay("No VisitedStarsCache.dat found. The game writes it in its local folder (on Windows " +
      "%LOCALAPPDATA%\\Frontier Developments\\Elite Dangerous\\<account>) once you have played on this PC.", "err");
    return;
  }
  files.forEach(function (f) {
    var li = document.createElement("li");
    var text = document.createElement("span");
    text.textContent = "Account " + f.account + ": " + f.systems.toLocaleString() + " systems in the game's list, " +
      f.notInJournals.toLocaleString() + " not in your journals (list of " + visitedDate(f.modifiedAt) + ")";
    var go = document.createElement("button");
    go.type = "button";
    go.className = "btn-mini";
    go.textContent = imp && imp.account === f.account ? "Import again" : "Import them";
    go.disabled = f.notInJournals === 0 && !(imp && imp.account === f.account);
    go.addEventListener("click", function () { visitedImport(f.account); });
    li.appendChild(text);
    li.appendChild(go);
    visitedList.appendChild(li);
  });
}
function visitedLoad() {
  visitedSay("", "");
  return fetch(apiUrl("/api/visited-cache"), { cache: "no-store" })
    .then(function (r) { return r.json(); })
    .then(visitedRender)
    .catch(function (e) { visitedSay("Could not read the game's list: " + String(e && e.message ? e.message : e), "err"); });
}
function visitedImport(account) {
  visitedSay("Importing…", "");
  fetch(apiUrl("/api/visited-cache/import"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ account: account }),
  })
    .then(function (r) { return r.json(); })
    .then(function (j) {
      if (!j || !j.ok) throw new Error((j && j.error) || "import failed");
      return visitedLoad().then(function () {
        visitedSay("Imported " + j.systems.toLocaleString() + " systems; " + j.notInJournals.toLocaleString() +
          " of them are new to the galaxy map and the planner.", "ok");
      });
    })
    .catch(function (e) { visitedSay("Could not import: " + String(e && e.message ? e.message : e), "err"); });
}

/** What ran when the page loaded, in the order it ran (main.js calls each module's in the file's old order). */
export function start() {
  if (importNewerGo) {
    importNewerGo.addEventListener("click", function () {
      var file = rememberedImportFile();
      if (!file) return;
      pollImport(); // refresh once so the apply flag below is the latest
      fetch(apiUrl("/api/feeder/import-dump/status?file=" + encodeURIComponent(file)), { cache: "no-store" })
        .then(function (r) { return r.json(); })
        .then(function (st) { return startImport(file, st && st.lastImport ? st.lastImport.apply : !!(importApply && importApply.checked)); });
    });
  }
  if (btnImportDump && importModal) {
    btnImportDump.addEventListener("click", function () {
      try { if (importFile && !importFile.value) importFile.value = localStorage.getItem(LS_IMPORT_FILE) || ""; } catch (e) {}
      importModal.classList.add("on");
      pollImport();
    });
  }
  if (btnImportVisited && visitedModal) {
    btnImportVisited.addEventListener("click", function () {
      visitedModal.classList.add("on");
      visitedLoad();
    });
  }
  if (visitedRemove) {
    visitedRemove.addEventListener("click", function () {
      fetch(apiUrl("/api/visited-cache/remove"), { method: "POST" })
        .then(function (r) { return r.json(); })
        .then(function () { return visitedLoad(); })
        .then(function () { visitedSay("The import is removed; only your journals count as visited now.", "ok"); })
        .catch(function (e) { visitedSay("Could not remove: " + String(e && e.message ? e.message : e), "err"); });
    });
  }
  if (visitedClose && visitedModal) visitedClose.addEventListener("click", function () { visitedModal.classList.remove("on"); });
  if (visitedModal) visitedModal.addEventListener("click", function (e) { if (e.target === visitedModal) visitedModal.classList.remove("on"); });

  if (importClose && importModal) importClose.addEventListener("click", function () { importModal.classList.remove("on"); });
  if (importModal) importModal.addEventListener("click", function (e) { if (e.target === importModal) importModal.classList.remove("on"); });
  if (importStart) {
    importStart.addEventListener("click", function () {
      var file = importFile ? importFile.value.trim() : "";
      if (!file) { showImportStatus("Enter the path to the .jsonl.gz file.", "err"); return; }
      try { localStorage.setItem(LS_IMPORT_FILE, file); } catch (e) {}
      void startImport(file, !!(importApply && importApply.checked));
    });
  }
  /* One silent check at start-up, so the button glows when there is something to import. */
  if (rememberedImportFile()) setTimeout(pollImport, 4000);
}
