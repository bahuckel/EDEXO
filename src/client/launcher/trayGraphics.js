/*
  Close to tray and hardware acceleration: the launcher's two app-level switches.
  Split out of public/launcher.js (discuss item 19, 1.3.1).
*/

/* ------------------------------------------------------------------ close to tray */
var trayPrefRow = document.getElementById("trayPrefRow");
var trayPref = document.getElementById("trayPref");
var trayNote = document.getElementById("trayNote");
export var trayWhere = /Windows/i.test(navigator.userAgent)
  ? "Closing (X) keeps the app running in the tray: the ˄ arrow next to the clock, bottom right of the taskbar. Click it, then the EDEXO icon to bring the launcher back; right-click the icon to quit."
  : "Closing (X) keeps the app running in the tray, the icon area in your desktop's panel. Click the EDEXO icon there to bring the launcher back; right-click it to quit.";
export function renderTrayPref(p) {
  if (!trayPrefRow || !trayPref || !p) return;
  trayPrefRow.hidden = false;
  if (trayNote) {
    // Only while it is on: with it off the X quits, and there is nothing in the tray to find.
    trayNote.hidden = !p.available || !p.enabled;
    trayNote.textContent = trayWhere;
  }
  trayPref.checked = !!p.enabled && !!p.available;
  trayPref.disabled = !p.available;
  trayPrefRow.classList.toggle("is-off", !p.available);
  trayPrefRow.title = p.available
    ? "Minimise still goes to the taskbar. " + trayWhere
    : p.reason || "This system has no tray.";
}

/*
  Hardware acceleration (electron/gpuSafeMode.cjs; L1, Linux ticket 2026-10-23). Ticked = the graphics card is used.
  It can have been turned off by itself (the GPU process died at start); the note says so and when. A change counts
  from the next start, so the note says that and offers the restart.
*/
var gfxPrefRow = document.getElementById("gfxPrefRow");
var gfxPref = document.getElementById("gfxPref");
var gfxNote = document.getElementById("gfxNote");
var gfxRestart = document.getElementById("gfxRestart");
function renderGfxPref(p) {
  if (!gfxPrefRow || !gfxPref || !p) return;
  gfxPrefRow.hidden = false;
  gfxPref.checked = !p.safeNext;
  gfxPref.disabled = !!p.locked;
  gfxPrefRow.classList.toggle("is-off", !!p.locked);
  gfxPrefRow.title = p.locked
    ? p.why === "env"
      ? "Off for every start while EDEXO_SAFE_GRAPHICS=1 is set."
      : "Off for this start: it was started with --disable-gpu."
    : "Uses the graphics card to draw the app and the galaxy map. Turn it off if the app crashes or its windows stay blank at start.";
  var pending = !!p.safeNow !== !!p.safeNext;
  var lines = [];
  if (p.safeNext && p.auto && p.reason)
    lines.push("Turned off by itself: the " + p.reason.replace(/^GPU process/, "graphics process") + ". Tick it to try the graphics card again.");
  if (p.safeNow && !pending) lines.push("Without it the galaxy map draws in software (slower) or falls back to the Classic map.");
  if (pending) lines.push(p.safeNext ? "Off from the next start." : "On from the next start.");
  if (gfxNote) {
    gfxNote.textContent = lines.join(" ");
    gfxNote.hidden = lines.length === 0;
  }
  if (gfxRestart) gfxRestart.hidden = !(pending && window.edexoElectron && typeof window.edexoElectron.relaunch === "function");
}

/** What ran when the page loaded, in the order it ran (main.js calls each module's in the file's old order). */
export function start() {
  (function () {
    var ee = window.edexoElectron;
    if (!ee || typeof ee.getTrayPref !== "function") return;
    ee.getTrayPref().then(renderTrayPref).catch(function () {});
    if (trayPref) {
      trayPref.addEventListener("change", function () {
        ee.setTrayPref({ enabled: trayPref.checked }).then(renderTrayPref).catch(function () {});
      });
    }
  })();
  (function () {
    var ee = window.edexoElectron;
    if (!ee || typeof ee.getGraphicsPref !== "function") return;
    ee.getGraphicsPref().then(renderGfxPref).catch(function () {});
    if (gfxPref) {
      gfxPref.addEventListener("change", function () {
        ee.setGraphicsPref({ hardware: gfxPref.checked }).then(renderGfxPref).catch(function () {});
      });
    }
    if (gfxRestart) {
      gfxRestart.addEventListener("click", function () {
        ee.relaunch();
      });
    }
  })();
}
