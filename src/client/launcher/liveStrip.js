// @ts-check
/*
  The live strip under the status card and the journal health line.
  Split out of public/launcher.js (discuss item 19, 1.3.1).
*/
import { readBoolLs, writeBoolLs } from "./network.js";
import { hudPaths } from "./hudOverlays.js";

/* ------------------------------------------------------------------ live strip + journal health */
var LS_STRIP = "edexo.launcher.strip";
var toggleLiveStrip = /** @type {HTMLInputElement | null} */ (document.getElementById("toggleLiveStrip"));
var liveStrip = document.getElementById("liveStrip");
/** @param {string} id @param {unknown} text @param {string} [cls] */
function setCell(id, text, cls) {
  var el = document.getElementById(id);
  if (!el) return;
  el.textContent = text == null || text === "" ? "—" : String(text);
  el.className = "v" + (text == null || text === "" ? " dim" : "") + (cls ? " " + cls : "");
}
/** @param {any} data  the server's /api/status answer */
export function renderLiveStrip(data) {
  if (!liveStrip) return;
  liveStrip.hidden = !readBoolLs(LS_STRIP, false);
  var l = data.live || {};
  setCell("lsSystem", l.systemName);
  setCell("lsBody", l.bodyName);
  setCell("lsBio", l.bioSignals == null ? "" : String(l.bioSignals));
  var cr = l.organicDataValueCredits;
  setCell(
    "lsUnsold",
    cr == null ? "" : Number(cr).toLocaleString("en-US") + " CR" + (l.organicPendingSampleCount > 0 ? " · " + l.organicPendingSampleCount + " pending" : ""),
  );
  var jt = l.jumpTarget;
  if (!jt) setCell("lsJump", "");
  else {
    var k = String(jt.starClass || "").toUpperCase();
    var cls = k === "H" ? "bad" : k === "N" ? "cool" : /^[KGBFOAM]$/.test(k) ? "" : "warn";
    setCell("lsJump", jt.starSystem + " · " + (k || "?") + (jt.arrived ? " · arrived" : ""), cls);
  }
}
/*
  Only while a HUD is up (that is when a silent journal costs something) and only when the
  journal has gone quiet for ten minutes: a wrong folder or a game that stopped writing.
*/
var lastHudPathCount = 0;
/** @param {any} data  the server's /api/status answer */
export function renderJournalHealth(data) {
  var el = document.getElementById("journalHealth");
  if (!el) return;
  var iso = data.lastJournalEventIso;
  var ageMin = iso ? (Date.now() - Date.parse(iso)) / 60000 : null;
  var quiet = ageMin != null && isFinite(ageMin) && ageMin >= 10;
  if (!(lastHudPathCount > 0) || !quiet || data.journalBoot) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  el.textContent =
    "A HUD is open but the journal has been silent for " + Math.round(/** @type {number} */ (ageMin)) + " min. If the game is running, " +
    "check the journal folder (" + (data.journalDir || "?") + ") — the HUDs only move when the game writes.";
}

/** What ran when the page loaded, in the order it ran (main.js calls each module's in the file's old order). */
export function start() {
  if (toggleLiveStrip) {
    const box = toggleLiveStrip;
    box.checked = readBoolLs(LS_STRIP, false);
    box.addEventListener("change", function () {
      writeBoolLs(LS_STRIP, box.checked);
      if (liveStrip) liveStrip.hidden = !box.checked;
    });
  }
  setInterval(function () {
    hudPaths().then(function (p) {
      lastHudPathCount = p.length;
    });
  }, 30000);
  hudPaths().then(function (p) {
    lastHudPathCount = p.length;
  });
}
