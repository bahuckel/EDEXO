// @ts-check
/*
  The commander dropdown (per-commander profiles, 1.3.1, owner 2026-10-25): whose data Compare and Colonize show.
  Shown only when the journals name two or more commanders. At start the app shows the newest journal's commander
  (the one playing, else the last one played); choosing another starts the app's server again for them, and the
  launcher loads again with it. A console server cannot start itself again: it says how instead.
*/
import { apiUrl } from "./network.js";

var cmdrPick = document.getElementById("cmdrPick");
var cmdrSelect = /** @type {HTMLSelectElement | null} */ (document.getElementById("cmdrSelect"));
var cmdrNote = document.getElementById("cmdrNote");
/**
 * The last `commanders` of /api/status: who the journals name, who the app shows, who the game plays.
 * @typedef {{ list?: { fid: string, name: string }[], active?: { fid: string, name: string } | null, game?: { fid: string, name: string } | null }} Commanders
 */
/** @type {Commanders | null} */
var lastCommanders = null;
var switching = false;
/** An error stays readable this long; the status poll would otherwise replace it within seconds. */
var errorUntil = 0;

/** @param {string} text @param {boolean} warn */
function setNote(text, warn) {
  if (!cmdrNote) return;
  cmdrNote.textContent = text || "";
  cmdrNote.classList.toggle("cmdr-pick__note--warn", Boolean(warn));
}

/** From /api/status (`commanders`); a frame without it changes nothing. */
/** @param {any} data */
export function renderCommanders(data) {
  /** @type {Commanders | undefined} */
  var c = data && data.commanders;
  if (!c || !cmdrPick || !cmdrSelect) return;
  const select = cmdrSelect;
  lastCommanders = c;
  var list = c.list || [];
  cmdrPick.hidden = list.length < 2;
  if (cmdrPick.hidden || switching) return;
  var key = list.map(function (x) { return x.fid + ":" + x.name; }).join("|") + "|" + (c.active ? c.active.fid : "");
  if (cmdrSelect.dataset.key !== key && document.activeElement !== cmdrSelect) {
    cmdrSelect.innerHTML = "";
    list.forEach(function (x) {
      var o = document.createElement("option");
      o.value = x.fid;
      o.textContent = "CMDR " + x.name;
      select.appendChild(o);
    });
    if (c.active) cmdrSelect.value = c.active.fid;
    cmdrSelect.dataset.key = key;
  }
  if (Date.now() < errorUntil) return;
  if (c.game && c.active && c.game.fid !== c.active.fid) setNote("The game is playing CMDR " + c.game.name + ".", true);
  else if (c.game) setNote("In the game now.", false);
  else setNote("", false);
}

/** @param {string} fid */
function waitFor(fid) {
  var t0 = Date.now();
  (function check() {
    fetch(apiUrl("/api/commanders"), { cache: "no-store" })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (j && j.active && j.active.fid === fid) location.reload();
        else if (Date.now() - t0 < 120000) setTimeout(check, 1000);
      })
      .catch(function () {
        // The server is starting again.
        if (Date.now() - t0 < 120000) setTimeout(check, 1000);
      });
  })();
}

/** What ran when the page loaded, in the order it ran (main.js calls each module's in the file's old order). */
export function start() {
  if (!cmdrSelect) return;
  const select = cmdrSelect;
  select.addEventListener("change", function () {
    var fid = select.value;
    var c = lastCommanders;
    if (!c || (c.active && c.active.fid === fid)) return;
    var target = (c.list || []).find(function (x) { return x.fid === fid; });
    var name = target ? target.name : fid;
    switching = true;
    select.disabled = true;
    setNote("Switching to CMDR " + name + "…", false);
    fetch(apiUrl("/api/commanders/switch"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fid: fid }),
    })
      .then(function (r) {
        return r.json().then(function (j) { return { ok: r.ok && j && j.ok, error: j && j.error }; });
      })
      .catch(function () { return { ok: false, error: "The app did not answer." }; })
      .then(function (r) {
        if (r.ok) {
          waitFor(fid);
          return;
        }
        switching = false;
        select.disabled = false;
        if (c && c.active) select.value = c.active.fid;
        errorUntil = Date.now() + 15000;
        setNote(r.error || "Could not switch commander.", true);
      });
  });
}
