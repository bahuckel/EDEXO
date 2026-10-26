/*
  The first-run card: LAN access, the tray, the journal folder and a first HUD.
  Split out of public/launcher.js (discuss item 19, 1.3.1).
*/
import { btnOptions } from "./status.js";
import { lanAccessToggle, readBoolLs, saveLanAccess, writeBoolLs } from "./network.js";
import { HUD_W, pickOverlay } from "./hudOverlays.js";
import { linuxSetupModal, linuxSetupPending, loadLinuxSetup, setLinuxSetupPending } from "./linuxSetup.js";
import { renderTrayPref, trayWhere } from "./trayGraphics.js";

/* ------------------------------------------------------------------ first-run wizard */
var LS_WIZARD = "edexo.launcher.wizardDone";
var wizardModal = document.getElementById("wizardModal");
var wizardShown = false;
export function maybeShowWizard(data) {
  if (wizardShown || !wizardModal || data.journalBoot) return;
  if (readBoolLs(LS_WIZARD, false)) return;
  wizardShown = true;
  var ok = data.journalDirConfiguredOk === true && data.journalFileCount > 0;
  var st = document.getElementById("wzJournal");
  var dir = document.getElementById("wzJournalDir");
  if (st) { st.textContent = ok ? "found, " + data.journalFileCount + " log file(s)" : data.journalDirConfiguredOk ? "folder found, no logs yet" : "not found — set it"; st.className = "st " + (ok ? "ok" : "bad"); }
  if (dir) dir.textContent = data.journalDir || "";
  fillWizardQuestions(data);
  // A Linux setup card already up steps aside and comes back when this one closes.
  if (linuxSetupModal && linuxSetupModal.classList.contains("on")) {
    linuxSetupModal.classList.remove("on");
    setLinuxSetupPending(true);
  }
  wizardModal.classList.add("on");
}
function closeWizard() {
  if (wizardModal) wizardModal.classList.remove("on");
  if (linuxSetupPending) {
    setLinuxSetupPending(false);
    void loadLinuxSetup(true);
  }
}
/*
  The two questions (combined plan, Phase 5 [O-B]). Each box is the setting itself, saved on
  the tick like its twin in the launcher: LAN access (only where the app has the switch; it
  applies at the next start) and Close to tray (Electron, where this system has a tray).
*/
export var wzLanStep = document.getElementById("wzLanStep");
var wzLan = document.getElementById("wzLan");
var wzLanSt = document.getElementById("wzLanSt");
var wzTrayStep = document.getElementById("wzTrayStep");
var wzTray = document.getElementById("wzTray");
var wzTrayNote = document.getElementById("wzTrayNote");
var WZ_TRAY_OFF = "Off: closing the window quits the app.";
function renderWzLan(la) {
  if (!wzLanSt || !la) return;
  var pending = !!la.saved !== !!la.active;
  wzLanSt.className = "st" + (la.saved ? " ok" : "");
  wzLanSt.textContent = pending
    ? la.saved
      ? "on after a restart"
      : "off after a restart"
    : la.active
      ? "on: the links are under Network"
      : "off: this PC only";
}
export function fillWizardQuestions(data) {
  var la = data && data.lanAccess;
  if (wzLanStep && wzLan && la) {
    wzLanStep.hidden = false;
    wzLan.checked = !!la.saved;
    renderWzLan(la);
  }
  var ee = window.edexoElectron;
  if (wzTrayStep && wzTray && ee && typeof ee.getTrayPref === "function") {
    ee.getTrayPref()
      .then(function (p) {
        if (!p || !p.available) return;
        wzTrayStep.hidden = false;
        wzTray.checked = !!p.enabled;
        if (wzTrayNote) wzTrayNote.textContent = p.enabled ? trayWhere : WZ_TRAY_OFF;
      })
      .catch(function () {});
  }
}

var wzDone = document.getElementById("wzDone");
var wzSetJournal = document.getElementById("wzSetJournal");
var wzOpenHud = document.getElementById("wzOpenHud");

/** What ran when the page loaded, in the order it ran (main.js calls each module's in the file's old order). */
export function start() {
  if (wzLan) wzLan.addEventListener("change", function () {
    if (lanAccessToggle) lanAccessToggle.checked = wzLan.checked;
    void saveLanAccess(wzLan.checked).then(function (j) {
      if (j && j.ok) renderWzLan(j.lanAccess);
    });
  });
  if (wzTray) wzTray.addEventListener("change", function () {
    var ee = window.edexoElectron;
    if (!ee || typeof ee.setTrayPref !== "function") return;
    ee.setTrayPref({ enabled: wzTray.checked })
      .then(function (p) {
        renderTrayPref(p);
        if (wzTrayNote && p) wzTrayNote.textContent = p.enabled ? trayWhere : WZ_TRAY_OFF;
      })
      .catch(function () {});
  });
  if (wzDone) wzDone.addEventListener("click", function () { writeBoolLs(LS_WIZARD, true); closeWizard(); });
  if (wzSetJournal) wzSetJournal.addEventListener("click", function () { closeWizard(); btnOptions.click(); });
  if (wzOpenHud) wzOpenHud.addEventListener("click", function () {
    void pickOverlay("/distance-overlay.html", HUD_W, 330).then(function () {
      var s = document.getElementById("wzHud");
      if (s) { s.textContent = "opened — look at the top right of your screen"; s.className = "st ok"; }
    });
  });
  if (wizardModal) wizardModal.addEventListener("click", function (e) { if (e.target === wizardModal) closeWizard(); });
}
