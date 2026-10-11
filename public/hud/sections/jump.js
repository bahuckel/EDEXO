import { api, esc, head, q } from "../core.js";
import { pref } from "../theme.js";

/* ============================================================== Next jump ==================== */
/*
  StarClass from `StartJump`. Scoopable main-sequence classes are the game's KGBFOAM rule; the
  rest earns a yellow triangle (no fuel there), a black hole a red one, a neutron star a blue one
  for those who boost. Everything else the journal can write (white dwarfs, T Tauri, Herbig,
  Wolf-Rayet, carbon stars) is simply "not scoopable".
*/
export function starKind(cls) {
  var c = String(cls || "").toUpperCase();
  if (!c) return { kind: "unknown", label: "?", note: "Star class unknown" };
  if (c === "H" || c === "SUPERMASSIVEBLACKHOLE")
    return {
      kind: "hole",
      label: c === "H" ? "Black hole" : "Supermassive black hole",
      note: "Black hole — no scoop, drop out early",
    };
  if (c === "N")
    return { kind: "neutron", label: "Neutron star", note: "Neutron star — jet cone boost, no scoop" };
  if (/^[KGBFOAM]$/.test(c)) return { kind: "scoop", label: c + " class", note: "Scoopable" };
  return { kind: "noscoop", label: c, note: "Not scoopable" };
}
export var jump = {
  title: "Next jump",
  html: function () {
    return (
      head("Next jump", "No jump") +
      '<div class="jump" data-f="jump">' +
      '<div class="jump__tri" data-f="tri" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 3 22 20H2Z"/><path class="jump__mark" d="M12 9v5M12 16.5v1"/></svg></div>' +
      '<div class="jump__body">' +
      '<div class="hud-big jump__sys" data-f="sys">—</div>' +
      '<div class="jump__cls"><span class="jump__star" data-f="star">—</span><span class="jump__note" data-f="note"></span></div>' +
      '<div class="jump__disc" data-f="disc" hidden></div>' +
      "</div></div>" +
      '<div class="jump__route" data-f="route" hidden></div>' +
      '<div class="jump__copied" data-f="copied" hidden></div>' +
      '<div class="jump__boxel" data-f="boxel" hidden></div>'
    );
  },
  render: function (d, root) {
    var jt = d.jumpTarget;
    var status = q(root, "status");
    var box = q(root, "jump");
    renderRouteStrip(d, q(root, "route"));
    renderBoxelCopied(d, q(root, "copied"));
    renderNextBoxel(d, q(root, "boxel"));
    if (!jt || !jt.starSystem) {
      renderDiscovered(null, q(root, "disc"));
      status.textContent = "No jump";
      box.className = "jump jump--none";
      q(root, "sys").textContent = "—";
      q(root, "star").textContent = "—";
      q(root, "note").textContent = "";
      return null;
    }
    var k = starKind(jt.starClass);
    var src = jt.source || "jump";
    status.textContent =
      src === "target" ? "Targeted" : src === "route" ? "Next on route" : jt.arrived ? "Arrived" : "Jumping";
    /*
      The triangle keeps its star-class colour. An earlier version turned it blue for an unvisited
      system and the owner asked for it back: the colour there already answers "is there fuel",
      which is the question the triangle exists for. The note below carries the other fact in
      words.
    */
    box.className = "jump jump--" + k.kind + (jt.arrived ? " jump--arrived" : "") + " jump--src-" + src;
    q(root, "sys").textContent = jt.starSystem;
    q(root, "star").textContent = k.label;
    q(root, "note").textContent = k.note;
    renderDiscovered(jt, q(root, "disc"));
    return null;
  },
};

/*
  Who has been to the system ahead (owner, 2026-10-06; it read "nobody has been here"): Undiscovered in
  light green, Discovered in dark orange-red, Discovered by you in blue, each with a shadow so it reads
  on a green-tinted custom HUD. Undiscovered / Discovered come from EDSM (server/firstFootfallLookup.ts:
  no answer yet shows nothing); "by you" from the commander's journals. Only before arriving.
*/
export function renderDiscovered(jt, el) {
  if (!el) return;
  var label = null;
  var kind = "";
  if (jt && jt.starSystem && !jt.arrived) {
    if (jt.discoveredByYou) {
      label = "Discovered by you";
      kind = "you";
    } else if (jt.likelyFirstFootfall === true) {
      label = "Undiscovered";
      kind = "new";
    } else if (jt.likelyFirstFootfall === false) {
      label = "Discovered";
      kind = "known";
    }
  }
  el.hidden = !label;
  el.className = "jump__disc" + (kind ? " jump__disc--" + kind : "");
  el.textContent = label || "";
}

/*
  "Next boxel" (plan 2.7, 2026-10-11): the expedition planner's best boxel within 500 ly by first-footfall
  credits per jump, one line under the jump. Off unless chosen in the launcher (edexoHudNextBoxel), like the
  credit line. Asked once per system the ship is in, with light=1: it never makes the server load the galaxy
  index for a HUD line.
*/
var nextBoxel = { key: null, text: null };
function millions(v) {
  return v >= 1e9 ? (v / 1e9).toFixed(1) + " B" : v >= 1e6 ? (v / 1e6).toFixed(1) + " M" : Math.round(v / 1e3) + " k";
}
export function renderNextBoxel(d, el) {
  if (!el) return;
  if (pref("edexoHudNextBoxel", "0") !== "1") {
    el.hidden = true;
    return;
  }
  var key = d.currentSystemAddress != null ? String(d.currentSystemAddress) : "";
  if (key && key !== nextBoxel.key) {
    nextBoxel.key = key;
    fetch(api("/api/expedition/field?radius=500&limit=1&light=1"), { cache: "no-store" })
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .then(function (j) {
        var b = j && j.boxels && j.boxels[0];
        nextBoxel.text = b
          ? '<span class="jump__boxel-k">Next boxel</span> ' +
            esc(b.name || b.code + " boxel") +
            ' <span class="jump__boxel-v">' + Math.round(b.distanceLy) + " ly · " + millions(b.evPerJump) + "/jump</span>"
          : null;
        el.hidden = !nextBoxel.text;
        el.innerHTML = nextBoxel.text || "";
      })
      .catch(function () {});
  }
  el.hidden = !nextBoxel.text;
  el.innerHTML = nextBoxel.text || "";
}

/*
  Boxel scanning (owner, 2026-10-06): what the boxel run or the F6 / F8 / F9 keys put on the clipboard,
  since a key press in the game shows nothing else — paste it in the galaxy map.
*/
export function renderBoxelCopied(d, el) {
  if (!el) return;
  var c = d.boxelCopied;
  if (!c || !c.name) {
    el.hidden = true;
    el.textContent = "";
    return;
  }
  el.hidden = false;
  el.innerHTML =
    '<span class="jump__copied-k">Copied</span> ' +
    esc(c.name) +
    (c.run ? ' <span class="jump__copied-run">· boxel run</span>' : "");
}

/*
  The route strip under the card (owner, 2026-09-13): the next hops as star-class letters in the
  KGBFOAM colours, a fuel pump on the star where the tank says to scoop — yellow to plan on it,
  red when skipping it means running dry. `⛽ +N` when that star is beyond the hops shown.
*/
export function fuelPump(level) {
  return (
    '<svg class="hop__fuel hop__fuel--' +
    level +
    '" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 20V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v15M4 20h12M7 7h6v4H7zM15 10h2a2 2 0 0 1 2 2v5a1.5 1.5 0 0 0 3 0v-7l-2.5-2.5"/></svg>'
  );
}
export function renderRouteStrip(d, el) {
  if (!el) return;
  var nav = d.liveShipFuelRange && d.liveShipFuelRange.navRoute;
  var hops = nav && nav.ahead ? nav.ahead : [];
  if (!hops.length) {
    el.hidden = true;
    el.innerHTML = "";
    return;
  }
  /*
    The red pump that is not on a hop ahead goes first (owner, 2026-10-12: at the end of the line it
    "does not really show you where you should refuel"): on the star the ship is at when that is the
    last one the tank reaches, or "!" when no scoopable star is in reach at all.
  */
  var html = "";
  if (nav.refuelInHops === 0 && nav.refuelLevel !== "none") {
    html +=
      '<span class="hop hop--beyond hop--dry hop--here" title="Scoop here: the last scoopable star this tank reaches">' +
      fuelPump(nav.refuelLevel) +
      'here</span><span class="hop__sep" aria-hidden="true">››</span>';
  } else if (nav.refuelInHops == null && nav.refuelLevel === "red") {
    html +=
      '<span class="hop hop--beyond hop--dry" title="No scoopable star within reach on this tank">' +
      fuelPump("red") +
      '!</span><span class="hop__sep" aria-hidden="true">››</span>';
  }
  for (var i = 0; i < hops.length; i++) {
    var h = hops[i];
    var k = starKind(h.starClass);
    /*
      The arrow's colour says what EDSM knows about the system it points at (owner, 2026-09-24):
      orange = someone has been there, electric blue = no record at all, grey = no answer — still
      waiting, or the request failed (no connection, rate limit, error, bad reply). Grey while
      waiting too, so orange only ever means EDSM said yes.

      The arrow only — the hop itself keeps the star-class colour it has always had, which is the
      fuel question and is not this one. See server/firstFootfallLookup.ts.
    */
    var ff = h.likelyFirstFootfall;
    var sepClass = ff === true ? " hop__sep--first" : ff === false ? "" : " hop__sep--unknown";
    var sepTitle =
      ff == null && h.firstFootfallNote
        ? ' title="' + esc(h.firstFootfallNote) + '"'
        : "";
    html +=
      (i ? '<span class="hop__sep' + sepClass + '"' + sepTitle + ' aria-hidden="true">››</span>' : "") +
      '<span class="hop hop--' +
      k.kind +
      '" title="' +
      esc(h.starSystem + " — " + k.label + (ff === true ? " — nobody has been here" : "")) +
      '">' +
      esc(h.starClass || "?") +
      (h.refuel && h.refuel !== "none" ? fuelPump(h.refuel) : "") +
      "</span>";
  }
  if (nav.refuelInHops != null && nav.refuelInHops > hops.length && nav.refuelLevel !== "none") {
    html +=
      '<span class="hop__sep" aria-hidden="true">››</span><span class="hop hop--beyond" title="Scoop in ' +
      nav.refuelInHops +
      ' jumps">' +
      fuelPump(nav.refuelLevel) +
      "+" +
      (nav.refuelInHops - hops.length) +
      "</span>";
  }
  el.innerHTML = html;
  el.hidden = false;
  fitRouteStrip(el, hops, nav);
}
/*
  One row, no wrapping (owner, 2026-09-14): drop hops off the end until the strip fits its width.
  If the pump's hop is cut, a "+N" with the pump takes the last place so the scoop is never lost.
*/
/**
 * Trim the strip to the width it has, and report how many hops survived.
 *
 * The count is the row's own answer to "how many are on screen", which depends on the HUD's width
 * and scale and on how long the star classes are — it is not a constant and cannot be assumed. It
 * is written back to the element so anything downstream reads the number that was actually drawn
 * rather than the number that was sent.
 */
export function fitRouteStrip(el, hops, _nav) {
  var pumpIdx = -1;
  for (var i = 0; i < hops.length; i++) if (hops[i].refuel && hops[i].refuel !== "none") pumpIdx = i;
  var guard = 0;
  var shown = el.querySelectorAll(".hop:not(.hop--beyond)").length;
  while (el.scrollWidth > el.clientWidth + 1 && guard++ < 60) {
    var kids = el.children;
    if (kids.length < 3) break;
    // remove the last hop and the separator before it
    el.removeChild(kids[kids.length - 1]);
    if (el.lastElementChild && el.lastElementChild.classList.contains("hop__sep"))
      el.removeChild(el.lastElementChild);
    shown = el.querySelectorAll(".hop:not(.hop--beyond)").length;
    if (pumpIdx >= shown && !el.querySelector(".hop--beyond")) {
      var tail = document.createElement("span");
      tail.className = "hop hop--beyond";
      tail.title = "Scoop in " + (pumpIdx + 1) + " jumps";
      tail.innerHTML = fuelPump(hops[pumpIdx].refuel) + "+" + (pumpIdx + 1 - shown);
      var sep = document.createElement("span");
      sep.className = "hop__sep";
      sep.setAttribute("aria-hidden", "true");
      sep.textContent = "››";
      el.appendChild(sep);
      el.appendChild(tail);
    }
  }
  shown = el.querySelectorAll(".hop:not(.hop--beyond)").length;
  el.dataset.shown = String(shown);
  el.dataset.of = String(hops.length);
  /*
    The whole plot is rarely on screen. Saying which part of it this is costs nothing and stops the
    strip reading as the entire route when it is the first thirteen hops of forty.
  */
  el.title = shown >= hops.length ? shown + " jumps ahead" : shown + " of " + hops.length + " jumps ahead";
  return shown;
}
