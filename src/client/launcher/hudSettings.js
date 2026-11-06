/*
  The HUD settings panel: colour theme and saved schemes, size, opacity, type, tilt, the sections' options, order and free placement, visibility; all mirrored to the server for the phone HUD.
  Split out of public/launcher.js (discuss item 19, 1.3.1).
*/
import { btnOverlayMenu, launcherActionMsg } from "./status.js";
import { apiUrl } from "./network.js";
import { PRESETS } from "../hud/presets";
import { HUD_MERGED, HUD_PATH_BY_SECTION, HUD_SECTION_BY_PATH, HUD_SECTION_LABEL, HUD_SECTION_ORDER, HUD_W, activeSections, hudMergeOn, hudPaths, hudPhoneSections, inHudQueue, pickOverlay, refreshPhoneSections, showSections } from "./hudOverlays.js";
import { MOTION_EVENT, fxOn } from "../motionCore";

/* ------------------------------------------------------------------ HUD settings (theme, order, corner) */
var LS_HUD_THEME = "edexoHudTheme";
var LS_HUD_CAND = "edexoHudCandOrder";
var LS_HUD_REGION = "edexoHudRegion";
/* Candidate settings (owner, 2026-11-05): scanned species placed / first / hidden, the most rows, the active scan first. */
var LS_HUD_CAND_SCANNED = "edexoHudCandScanned";
var LS_HUD_CAND_MAX = "edexoHudCandMax";
var LS_HUD_CAND_ACTIVE_TOP = "edexoHudCandActiveTop";
function readCandMax() {
  try {
    var n = Math.round(parseFloat(localStorage.getItem(LS_HUD_CAND_MAX) || ""));
    return isFinite(n) ? Math.min(30, Math.max(1, n)) : 9;
  } catch (e) {
    return 9;
  }
}
var LS_HUD_SCALE = "edexoHudScale";
var LS_HUD_ALPHA = "edexoHudOpacity";
var LS_HUD_AUDIO = "edexoHudAudio";
var LS_HUD_COMPACT = "edexoHudCompact";
var LS_HUD_RELEVANT = "edexoHudRelevant";
var LS_HUD_TYPE = "edexoHudType";
var LS_HUD_CREDIT = "edexoHudCredit";
var LS_HUD_NEXT_BOXEL = "edexoHudNextBoxel";
/* The fuel bar at a neutron route's refuel stop (2026-10-29): on unless switched off. */
var LS_HUD_REFUEL_BAR = "edexoHudRefuelBar";
var LS_HUD_RADAR_ALWAYS = "edexoHudRadarAlways";
var LS_HUD_AIM = "edexoHudAim";
var LS_HUD_PITCH_READER = "edexoHudPitchReader";
var LS_HUD_DISTANCE_READER = "edexoHudDistanceReader";
/* The pitch reader's HUD colours (owner 2026-11-06): default or the XML's GUIColour matrix. */
var LS_HUD_COLOUR = "edexoHudColour";
/* Colonize HUD (1.3.0): materials and other sites on unless switched off; finished lines off unless switched on. */
var HUD_CZ_PREFS = [
  { id: "hudCzNeeds", ls: "edexoHudCzNeeds", key: "czNeeds", def: true },
  { id: "hudCzSites", ls: "edexoHudCzSites", key: "czSites", def: true },
  { id: "hudCzFinished", ls: "edexoHudCzFinished", key: "czFinished", def: false },
];
function readCzPref(p) {
  try {
    var v = localStorage.getItem(p.ls);
    return p.def ? v !== "0" : v === "1";
  } catch (e) {
    return p.def;
  }
}
var LS_HUD_TILT = "edexoHudTilt";
var LS_HUD_TILT_MODE = "edexoHudTiltMode";
var LS_HUD_SLANT = "edexoHudSlant";
// The swatches: each preset's accent, from the HUD's own colours (hud/presets.ts); a copy here until 1.3.1.
var HUD_PRESETS = Object.fromEntries(Object.keys(PRESETS).map(function (k) { return [k, PRESETS[k].accent]; }));
function readTheme() {
  try {
    return JSON.parse(localStorage.getItem(LS_HUD_THEME) || "{}") || {};
  } catch (e) {
    return {};
  }
}
/* Mirror every HUD setting to the server, so a phone renders the HUD the same way (task 13). */
var syncHudPrefsTimer = null;
function hudPrefsNow() {
  var prefs = {};
  try { prefs.theme = JSON.parse(localStorage.getItem(LS_HUD_THEME) || "{}") || {}; } catch (e) {}
  try { var sc = parseFloat(localStorage.getItem(LS_HUD_SCALE) || ""); if (isFinite(sc)) prefs.scale = sc; } catch (e) {}
  try { var op = parseFloat(localStorage.getItem(LS_HUD_ALPHA) || ""); if (isFinite(op)) prefs.opacity = op; } catch (e) {}
  try { prefs.candOrder = localStorage.getItem(LS_HUD_CAND) || "likelihood"; } catch (e) {}
  try { prefs.region = localStorage.getItem(LS_HUD_REGION) !== "0"; } catch (e) {}
  try { prefs.candScanned = localStorage.getItem(LS_HUD_CAND_SCANNED) || "place"; } catch (e) {}
  prefs.candMax = readCandMax();
  try { prefs.candActiveTop = localStorage.getItem(LS_HUD_CAND_ACTIVE_TOP) !== "0"; } catch (e) {}
  try { prefs.audio = localStorage.getItem(LS_HUD_AUDIO) === "1"; } catch (e) {}
  try { prefs.compact = localStorage.getItem(LS_HUD_COMPACT) === "1"; } catch (e) {}
  try { prefs.relevant = localStorage.getItem(LS_HUD_RELEVANT) === "1"; } catch (e) {}
  try { prefs.hudType = localStorage.getItem(LS_HUD_TYPE) || "original"; } catch (e) {}
  try { prefs.credit = localStorage.getItem(LS_HUD_CREDIT) || "off"; } catch (e) {}
  try { prefs.nextBoxel = localStorage.getItem(LS_HUD_NEXT_BOXEL) === "1"; } catch (e) {}
  try { prefs.refuelBar = localStorage.getItem(LS_HUD_REFUEL_BAR) !== "0"; } catch (e) {}
  try { prefs.radarAlways = localStorage.getItem(LS_HUD_RADAR_ALWAYS) === "1"; } catch (e) {}
  try { prefs.pitchReader = localStorage.getItem(LS_HUD_PITCH_READER) === "1"; } catch (e) {}
  try { prefs.distanceReader = localStorage.getItem(LS_HUD_DISTANCE_READER) === "1"; } catch (e) {}
  try { prefs.hudColour = localStorage.getItem(LS_HUD_COLOUR) === "xml" ? "xml" : "default"; } catch (e) {}
  HUD_CZ_PREFS.forEach(function (p) { prefs[p.key] = readCzPref(p); });
  try { var tl = parseFloat(localStorage.getItem(LS_HUD_TILT) || ""); prefs.tilt = isFinite(tl) ? tl : 15; } catch (e) {}
  try { prefs.tiltMode = localStorage.getItem(LS_HUD_TILT_MODE) === "slant" ? "slant" : "turn"; } catch (e) {}
  try { var sl = parseFloat(localStorage.getItem(LS_HUD_SLANT) || ""); prefs.slant = isFinite(sl) ? sl : 6; } catch (e) {}
  if (hudPhoneSections) prefs.sections = hudPhoneSections.slice();
  return prefs;
}
export function syncHudPrefs() {
  /*
    Live to the overlays first (owner, 2026-09-26). They have a session of their own now, so
    the storage event that used to move them while a slider was dragged no longer reaches
    them; the server mirror arrives ~1.5 s after the slider stops. The Electron process
    forwards this to every HUD window at once.
  */
  try {
    if (window.edexoElectron && typeof window.edexoElectron.pushHudPrefs === "function") {
      window.edexoElectron.pushHudPrefs(hudPrefsNow());
    }
  } catch (e) {
    /* the mirror below still gets there */
  }
  if (syncHudPrefsTimer) clearTimeout(syncHudPrefsTimer);
  syncHudPrefsTimer = setTimeout(function () {
    syncHudPrefsTimer = null;
    var prefs = hudPrefsNow();
    fetch(apiUrl("/api/settings/hud-prefs"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(prefs),
    }).catch(function () {});
  }, 400);
}
function writeTheme(t) {
  try {
    localStorage.setItem(LS_HUD_THEME, JSON.stringify(t));
  } catch (e) {}
  renderSwatches();
  syncHudPrefs();
}
var hudSwatches = document.getElementById("hudSwatches");
/* Saved HUD colours (guild tester report, 2026-09-30: "allow people to save their own"). */
var LS_HUD_SCHEMES = "edexoHudSchemes";
function readSchemes() {
  try {
    var v = JSON.parse(localStorage.getItem(LS_HUD_SCHEMES) || "[]");
    return Array.isArray(v)
      ? v.filter(function (x) {
          return x && typeof x.name === "string" && /^#[0-9a-f]{6}$/i.test(x.accent || "") && /^#[0-9a-f]{6}$/i.test(x.text || "");
        })
      : [];
  } catch (e) {
    return [];
  }
}
function writeSchemes(list) {
  try { localStorage.setItem(LS_HUD_SCHEMES, JSON.stringify(list.slice(0, 20))); } catch (e) {}
}
var hudThemeAccent = document.getElementById("hudThemeAccent");
var hudThemeText = document.getElementById("hudThemeText");
function renderSwatches() {
  if (!hudSwatches) return;
  var t = readTheme();
  var cur = t.preset || "orange";
  hudSwatches.innerHTML = "";
  Object.keys(HUD_PRESETS).forEach(function (name) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "hud-swatch";
    b.title = name;
    b.style.background = HUD_PRESETS[name];
    b.setAttribute("role", "radio");
    b.setAttribute("aria-pressed", cur === name ? "true" : "false");
    b.addEventListener("click", function () {
      // A text colour of one's own and the last custom accent stay through a preset (owner, 2026-10-31: the custom
      // text colour was lost when switching between the HUD colours).
      var now = readTheme();
      writeTheme({ preset: name, accent: now.accent, text: now.text });
    });
    hudSwatches.appendChild(b);
  });
  readSchemes().forEach(function (sc) {
    var wrap = document.createElement("span");
    wrap.className = "hud-scheme";
    var b = document.createElement("button");
    b.type = "button";
    b.className = "hud-swatch";
    b.title = sc.name;
    b.style.background = "linear-gradient(135deg, " + sc.accent + " 58%, " + sc.text + " 58%)";
    b.setAttribute("role", "radio");
    var on = t.preset === "custom" && t.accent === sc.accent && t.text === sc.text;
    b.setAttribute("aria-pressed", on ? "true" : "false");
    b.addEventListener("click", function () {
      writeTheme({ preset: "custom", accent: sc.accent, text: sc.text });
    });
    var label = document.createElement("span");
    label.textContent = sc.name;
    var x = document.createElement("button");
    x.type = "button";
    x.className = "hud-scheme__x";
    x.title = "Forget " + sc.name;
    x.textContent = "\u00d7";
    x.addEventListener("click", function () {
      writeSchemes(readSchemes().filter(function (o) { return o.name !== sc.name; }));
      renderSwatches();
    });
    wrap.appendChild(b);
    wrap.appendChild(label);
    wrap.appendChild(x);
    hudSwatches.appendChild(wrap);
  });
  if (hudThemeAccent && t.accent) hudThemeAccent.value = t.accent;
  if (hudThemeText) hudThemeText.value = t.text || (PRESETS[cur] && PRESETS[cur].text) || hudThemeText.value;
  var reset = document.getElementById("hudThemeTextReset");
  if (reset) {
    reset.disabled = !t.text;
    // Off, it says why rather than looking busy (owner, 2026-11-01: "loads forever").
    reset.title = t.text
      ? "Back to the text colour of the scheme picked above."
      : "The text is already the scheme's own colour; pick a custom text colour first.";
  }
}
/* The accent of one's own: the custom scheme, the text colour kept as it is. */
function customTheme() {
  var now = readTheme();
  writeTheme({ preset: "custom", accent: hudThemeAccent.value, text: now.text });
}
/* A text colour of one's own: over whichever scheme is on, preset or custom, until "Scheme's text". */
function customText() {
  var now = readTheme();
  writeTheme({ preset: now.preset || "orange", accent: now.accent, text: hudThemeText.value });
}
function schemeText() {
  var now = readTheme();
  writeTheme({ preset: now.preset || "orange", accent: now.accent });
}
var hudSchemeName = document.getElementById("hudSchemeName");
var hudSchemeSave = document.getElementById("hudSchemeSave");
function saveScheme() {
  var n = ((hudSchemeName && hudSchemeName.value) || "").trim().slice(0, 24);
  if (!n || !hudThemeAccent || !hudThemeText) return;
  var list = readSchemes().filter(function (o) { return o.name.toLowerCase() !== n.toLowerCase(); });
  list.push({ name: n, accent: hudThemeAccent.value, text: hudThemeText.value });
  writeSchemes(list);
  hudSchemeName.value = "";
  writeTheme({ preset: "custom", accent: hudThemeAccent.value, text: hudThemeText.value });
}
/* size + opacity: the HUD pages read the same keys and re-apply on the storage event */
var hudScale = document.getElementById("hudScale");
var hudScaleOut = document.getElementById("hudScaleOut");
var hudAlpha = document.getElementById("hudAlpha");
var hudAlphaOut = document.getElementById("hudAlphaOut");
function showSizeOutputs() {
  if (hudScale && hudScaleOut) hudScaleOut.textContent = hudScale.value + " %";
  if (hudAlpha && hudAlphaOut) hudAlphaOut.textContent = hudAlpha.value + " %";
}
/* HUD type and the Elite Style's angle (owner, 2026-10-04). */
var hudType = document.getElementById("hudType");
var hudTilt = document.getElementById("hudTilt");
var hudTiltOut = document.getElementById("hudTiltOut");
var hudTiltRow = document.getElementById("hudTiltRow");
var hudTiltMode = document.getElementById("hudTiltMode");
var hudSlant = document.getElementById("hudSlant");
var hudSlantOut = document.getElementById("hudSlantOut");
var hudTurnRow = document.getElementById("hudTurnRow");
var hudSlantRow = document.getElementById("hudSlantRow");
function syncHudTypeUi() {
  if (hudTiltOut && hudTilt) hudTiltOut.textContent = hudTilt.value + "°";
  if (hudSlantOut && hudSlant) hudSlantOut.textContent = hudSlant.value + "°";
  if (hudTiltRow && hudType) hudTiltRow.style.display = hudType.value === "elite" ? "" : "none";
  var slant = hudTiltMode && hudTiltMode.value === "slant";
  if (hudTurnRow) hudTurnRow.style.display = slant ? "none" : "";
  if (hudSlantRow) hudSlantRow.style.display = slant ? "" : "none";
}
/* "HUD Overlay by EDEXO" (owner, 2026-10-09; "by EDEXO-Compare" until 1.3.0): off unless chosen, at the top or the bottom. */
var hudCredit = document.getElementById("hudCredit");
/* "Next boxel" under the Next jump HUD (plan 2.7): off unless chosen. */
var hudNextBoxel = document.getElementById("hudNextBoxel");
var hudRefuelBar = document.getElementById("hudRefuelBar");
var hudRadarAlways = document.getElementById("hudRadarAlways");
var hudAim = document.getElementById("hudAim");
var hudPitchReader = document.getElementById("hudPitchReader");
var hudDistanceReader = document.getElementById("hudDistanceReader");
var hudColourSel = document.getElementById("hudColour");
var hudCompact = document.getElementById("hudCompact");
var hudRelevant = document.getElementById("hudRelevant");
var hudAudio = document.getElementById("hudAudio");
var hudCandOrder = document.getElementById("hudCandOrder");
var hudRegion = document.getElementById("hudRegion");
var hudCandScanned = document.getElementById("hudCandScanned");
var hudCandMax = document.getElementById("hudCandMax");
var hudCandActiveTop = document.getElementById("hudCandActiveTop");
var hudCorner = document.getElementById("hudCorner");
var hudOrderList = document.getElementById("hudOrderList");
export var hudOrder;
function layoutOrderKeys() {
  // window keys are page paths (query aside); the merged HUD is one window and sorts first
  return [HUD_MERGED].concat(
    hudOrder.map(function (s) {
      return HUD_PATH_BY_SECTION[s];
    }),
  );
}
function pushLayout() {
  var ee = window.edexoElectron;
  if (ee && typeof ee.setHudLayout === "function") {
    void Promise.resolve(ee.setHudLayout({ corner: hudCorner ? hudCorner.value : "tr", order: layoutOrderKeys() })).then(
      function () {
        return refreshPhoneSections();
      },
    ).catch(function () {});
  }
  // The merged HUD orders its sections itself; re-show it so the panel follows the list.
  if (hudMergeOn()) {
    inHudQueue(function () {
      return hudPaths().then(function (paths) {
        var active = activeSections(paths);
        if (active.length) return showSections(active);
      });
    }).catch(function (e) {
      launcherActionMsg.className = "msg-launcher err";
      launcherActionMsg.textContent = "HUD reorder failed: " + String(e && e.message ? e.message : e);
    });
  }
}
function renderOrderList() {
  if (!hudOrderList) return;
  hudOrderList.innerHTML = "";
  hudOrder.forEach(function (sec, i) {
    var li = document.createElement("li");
    var up = document.createElement("button");
    up.type = "button";
    up.textContent = "▲";
    up.title = "Move up";
    up.disabled = i === 0;
    var down = document.createElement("button");
    down.type = "button";
    down.textContent = "▼";
    down.title = "Move down";
    down.disabled = i === hudOrder.length - 1;
    var name = document.createElement("span");
    name.textContent = HUD_SECTION_LABEL[sec] || sec;
    up.addEventListener("click", function () {
      hudOrder.splice(i - 1, 0, hudOrder.splice(i, 1)[0]);
      renderOrderList();
      pushLayout();
    });
    down.addEventListener("click", function () {
      hudOrder.splice(i + 1, 0, hudOrder.splice(i, 1)[0]);
      renderOrderList();
      pushLayout();
    });
    li.appendChild(up);
    li.appendChild(down);
    li.appendChild(name);
    if (fxOn("drag")) {
      var grip = document.createElement("span");
      grip.className = "hud-order__grip";
      grip.textContent = "⠿";
      grip.title = "Drag to move (the arrows move it one place)";
      grip.setAttribute("aria-hidden", "true");
      grip.addEventListener("pointerdown", function (ev) {
        startOrderDrag(ev, li, i);
      });
      li.appendChild(grip);
    }
    hudOrderList.appendChild(li);
  });
}

/*
  M4 Drag to reorder (owner 2026-11-05): the row lifts to 105 % and follows the pointer, the rows it passes slide out
  of its way, and it drops into the gap. The arrows stay for the keyboard. Options › Look › Motion › Drag to reorder
  (level Full) in the app; off, there is no grip.
*/
// The grip comes and goes with the switch, changed here or in the app.
window.addEventListener(MOTION_EVENT, function () {
  renderOrderList();
});
function startOrderDrag(ev, li, from) {
  if (ev.button !== 0 || !hudOrderList) return;
  ev.preventDefault();
  var rows = Array.prototype.slice.call(hudOrderList.children);
  var rects = rows.map(function (r) {
    return r.getBoundingClientRect();
  });
  var step = rects.length > 1 ? rects[1].top - rects[0].top : rects[0].height;
  var startY = ev.clientY;
  var to = from;
  li.classList.add("is-lifted");
  li.style.transform = "scale(1.05)";
  hudOrderList.classList.add("is-sorting");
  var grip = ev.currentTarget;
  try {
    grip.setPointerCapture(ev.pointerId);
  } catch (e) {
    /* no such pointer any more: the moves still reach the grip while over it */
  }
  function move(e) {
    var dy = e.clientY - startY;
    // Kept inside the list.
    dy = Math.max(rects[0].top - rects[from].top, Math.min(rects[rects.length - 1].top - rects[from].top, dy));
    li.style.transform = "translateY(" + dy + "px) scale(1.05)";
    var mid = rects[from].top + rects[from].height / 2 + dy;
    to = from;
    for (var k = 0; k < rects.length; k++) {
      if (k < from && mid < rects[k].top + rects[k].height / 2) {
        to = k;
        break;
      }
      if (k > from && mid > rects[k].top + rects[k].height / 2) to = k;
    }
    rows.forEach(function (r, k) {
      if (r === li) return;
      var shift = k > from && k <= to ? -step : k < from && k >= to ? step : 0;
      r.style.transform = shift ? "translateY(" + shift + "px)" : "";
    });
  }
  function end(e) {
    grip.removeEventListener("pointermove", move);
    grip.removeEventListener("pointerup", end);
    grip.removeEventListener("pointercancel", end);
    hudOrderList.classList.remove("is-sorting");
    if (e.type === "pointerup" && to !== from) {
      hudOrder.splice(to, 0, hudOrder.splice(from, 1)[0]);
      renderOrderList();
      pushLayout();
      return;
    }
    li.classList.remove("is-lifted");
    rows.forEach(function (r) {
      r.style.transform = "";
    });
  }
  grip.addEventListener("pointermove", move);
  grip.addEventListener("pointerup", end);
  grip.addEventListener("pointercancel", end);
}

/*
  Free move (owner, 2026-10-02): the stack leaves its corner for a spot dragged anywhere on any
  screen. Electron keeps the spot with the layout; "Move HUD" starts placing (the HUDs take the
  mouse and show a frame), Done on the HUD or here ends it.
*/
var hudFree = document.getElementById("hudFree");
var hudMove = document.getElementById("hudMove");
var hudMoveHint = document.getElementById("hudMoveHint");
var hudMoving = false;
function renderFreeMove(freeOn, moving) {
  if (hudFree) hudFree.checked = !!freeOn;
  if (hudCorner) hudCorner.disabled = !!freeOn;
  hudMoving = !!moving;
  if (hudMove) {
    hudMove.disabled = !freeOn;
    var wrap = document.getElementById("hudMoveWrap");
    if (wrap) {
      wrap.title = freeOn
        ? hudMoving
          ? "Ends placing: the HUD stays where you dropped it."
          : "Drag the HUD by its frame to where you want it."
        : 'Tick "Free move HUD" first: the HUD can only be placed by hand in free move.';
    }
    hudMove.textContent = hudMoving ? "Done" : "Move HUD";
    hudMove.setAttribute("aria-pressed", hudMoving ? "true" : "false");
  }
  if (hudMoveHint) hudMoveHint.hidden = !hudMoving;
}
function setHudMoving(on) {
  var ee = window.edexoElectron;
  if (!ee || typeof ee.setHudMoveMode !== "function") return;
  ee.setHudMoveMode({ on: on }).then(function (r) {
    renderFreeMove(hudFree && hudFree.checked, r && r.moving);
  }).catch(function () {});
}

/*
  Show / Hide every HUD (owner, 2026-09-28). The state lives in Electron (hud-layout.json), so
  it survives a restart, and the hotkey and the tray change it too: Electron tells this page
  on every change (`onHudVisibility`), and the modal asks again whenever it opens.
*/
var hudVisShow = document.getElementById("hudVisShow");
var hudVisHide = document.getElementById("hudVisHide");
var hudVisSummary = document.getElementById("hudVisSummary");
function renderHudVisibility(v) {
  var hidden = !!(v && v.hidden);
  if (hudVisShow) hudVisShow.setAttribute("aria-pressed", hidden ? "false" : "true");
  if (hudVisHide) hudVisHide.setAttribute("aria-pressed", hidden ? "true" : "false");
  if (v && typeof v.moving === "boolean") renderFreeMove(hudFree && hudFree.checked, v.moving);
  if (hudVisSummary) {
    var n = v && typeof v.count === "number" ? v.count : null;
    hudVisSummary.textContent =
      (hidden ? "HUDs are hidden" : v && v.gameAway ? "HUDs wait for Elite" : v && v.focusAway ? "HUDs wait for Elite in front" : "HUDs are shown") +
      (n === 0 ? " (none open)" : n ? " (" + n + " open)" : "");
  }
}
function setHudVisibility(hidden) {
  var ee = window.edexoElectron;
  if (!ee || typeof ee.toggleHudVisibility !== "function") return;
  ee.toggleHudVisibility({ hidden: hidden }).then(function (r) {
    renderHudVisibility({ hidden: r && r.hidden });
  }).catch(function () {});
}
// Hide when Elite is not in front (owner, 2026-09-30): saved by the app with the HUD layout, on by default.
var hudHideUnfocused = document.getElementById("hudHideUnfocused");
async function loadHudSettingsIntoModal() {
  renderSwatches();
  if (hudCandOrder) hudCandOrder.value = (function () { try { return localStorage.getItem(LS_HUD_CAND) || "likelihood"; } catch (e) { return "likelihood"; } })();
  if (hudRegion) hudRegion.checked = (function () { try { return localStorage.getItem(LS_HUD_REGION) !== "0"; } catch (e) { return true; } })();
  if (hudCandScanned) hudCandScanned.value = (function () { try { var v = localStorage.getItem(LS_HUD_CAND_SCANNED); return v === "top" || v === "hidden" ? v : "place"; } catch (e) { return "place"; } })();
  if (hudCandMax) hudCandMax.value = String(readCandMax());
  if (hudCandActiveTop) hudCandActiveTop.checked = (function () { try { return localStorage.getItem(LS_HUD_CAND_ACTIVE_TOP) !== "0"; } catch (e) { return true; } })();
  if (hudAudio) hudAudio.checked = (function () { try { return localStorage.getItem(LS_HUD_AUDIO) === "1"; } catch (e) { return false; } })();
  if (hudCompact) hudCompact.checked = (function () { try { return localStorage.getItem(LS_HUD_COMPACT) === "1"; } catch (e) { return false; } })();
  if (hudType) hudType.value = (function () { try { return localStorage.getItem(LS_HUD_TYPE) || "original"; } catch (e) { return "original"; } })();
  if (hudCredit) hudCredit.value = (function () { try { var v = localStorage.getItem(LS_HUD_CREDIT); return v === "top" || v === "bottom" ? v : "off"; } catch (e) { return "off"; } })();
  if (hudNextBoxel) hudNextBoxel.checked = (function () { try { return localStorage.getItem(LS_HUD_NEXT_BOXEL) === "1"; } catch (e) { return false; } })();
  if (hudRefuelBar) hudRefuelBar.checked = (function () { try { return localStorage.getItem(LS_HUD_REFUEL_BAR) !== "0"; } catch (e) { return true; } })();
  if (hudRadarAlways) hudRadarAlways.checked = (function () { try { return localStorage.getItem(LS_HUD_RADAR_ALWAYS) === "1"; } catch (e) { return false; } })();
  HUD_CZ_PREFS.forEach(function (p) {
    var box = document.getElementById(p.id);
    if (box) box.checked = readCzPref(p);
  });
  if (hudTilt) hudTilt.value = (function () { try { var v = parseFloat(localStorage.getItem(LS_HUD_TILT) || "15"); return String(isFinite(v) ? v : 15); } catch (e) { return "15"; } })();
  if (hudTiltMode) hudTiltMode.value = (function () { try { return localStorage.getItem(LS_HUD_TILT_MODE) === "slant" ? "slant" : "turn"; } catch (e) { return "turn"; } })();
  if (hudSlant) hudSlant.value = (function () { try { var v = parseFloat(localStorage.getItem(LS_HUD_SLANT) || "6"); return String(isFinite(v) ? v : 6); } catch (e) { return "6"; } })();
  syncHudTypeUi();
  if (hudRelevant) hudRelevant.checked = (function () { try { return localStorage.getItem(LS_HUD_RELEVANT) === "1"; } catch (e) { return false; } })();
  if (hudScale) hudScale.value = String(Math.round((function () { try { return parseFloat(localStorage.getItem(LS_HUD_SCALE) || "1") || 1; } catch (e) { return 1; } })() * 100));
  if (hudAlpha) hudAlpha.value = String(Math.round((function () { try { var v = parseFloat(localStorage.getItem(LS_HUD_ALPHA) || "0.45"); return isFinite(v) ? v : 0.45; } catch (e) { return 0.45; } })() * 100));
  showSizeOutputs();
  var ee = window.edexoElectron;
  if (ee && typeof ee.getHudLayout === "function") {
    try {
      var lay = await ee.getHudLayout();
      if (lay && hudCorner && lay.corner) hudCorner.value = lay.corner;
      if (lay) renderFreeMove(lay.freeOn === true, lay.moving === true);
      if (lay) renderHudVisibility({ hidden: lay.hidden, count: lay.count });
      if (lay && Array.isArray(lay.order) && lay.order.length) {
        var secs = lay.order.map(function (k) { return HUD_SECTION_BY_PATH[k]; }).filter(Boolean);
        hudOrder = secs.concat(HUD_SECTION_ORDER.filter(function (s) { return secs.indexOf(s) < 0; }));
      }
    } catch (e) {}
  }
  renderOrderList();
}
var ovJump = document.getElementById("ovJump");
var ovAchievement = document.getElementById("ovAchievement");
var ovNotable = document.getElementById("ovNotable");
var ovNotices = document.getElementById("ovNotices");
var ovColonize = document.getElementById("ovColonize");
var ovShip = document.getElementById("ovShip");
var ovCarrier = document.getElementById("ovCarrier");

/** What ran when the page loaded, in the order it ran (main.js calls each module's in the file's old order). */
export function start() {
  setTimeout(syncHudPrefs, 2500);
  if (hudThemeAccent) hudThemeAccent.addEventListener("input", customTheme);
  if (hudSchemeSave) hudSchemeSave.addEventListener("click", saveScheme);
  if (hudSchemeName) {
    hudSchemeName.addEventListener("keydown", function (ev) {
      if (ev.key === "Enter") saveScheme();
    });
  }
  if (hudThemeText) hudThemeText.addEventListener("input", customText);
  var hudThemeTextReset = document.getElementById("hudThemeTextReset");
  if (hudThemeTextReset) hudThemeTextReset.addEventListener("click", schemeText);
  if (hudScale) {
    hudScale.addEventListener("input", function () {
      showSizeOutputs();
      try { localStorage.setItem(LS_HUD_SCALE, String(Number(hudScale.value) / 100)); } catch (e) {}
      syncHudPrefs();
    });
  }
  if (hudAlpha) {
    hudAlpha.addEventListener("input", function () {
      showSizeOutputs();
      try { localStorage.setItem(LS_HUD_ALPHA, String(Number(hudAlpha.value) / 100)); } catch (e) {}
      syncHudPrefs();
    });
  }
  if (hudTiltMode) {
    hudTiltMode.addEventListener("change", function () {
      try { localStorage.setItem(LS_HUD_TILT_MODE, hudTiltMode.value); } catch (e) {}
      syncHudTypeUi();
      syncHudPrefs();
    });
  }
  if (hudSlant) {
    hudSlant.addEventListener("input", function () {
      try { localStorage.setItem(LS_HUD_SLANT, hudSlant.value); } catch (e) {}
      syncHudTypeUi();
      syncHudPrefs();
    });
  }
  /* Each settings fold remembers whether it was open (owner, 2026-10-04). */
  document.querySelectorAll("details.hud-group").forEach(function (d) {
    var key = "edexoHudGroup." + d.getAttribute("data-group");
    try {
      var v = localStorage.getItem(key);
      if (v === "1") d.open = true;
      else if (v === "0") d.open = false;
    } catch (e) {}
    d.addEventListener("toggle", function () {
      try { localStorage.setItem(key, d.open ? "1" : "0"); } catch (e) {}
    });
  });
  if (hudType) {
    hudType.addEventListener("change", function () {
      try { localStorage.setItem(LS_HUD_TYPE, hudType.value); } catch (e) {}
      syncHudTypeUi();
      syncHudPrefs();
    });
  }
  if (hudTilt) {
    hudTilt.addEventListener("input", function () {
      try { localStorage.setItem(LS_HUD_TILT, hudTilt.value); } catch (e) {}
      syncHudTypeUi();
      syncHudPrefs();
    });
  }
  if (hudCredit) {
    hudCredit.addEventListener("change", function () {
      try { localStorage.setItem(LS_HUD_CREDIT, hudCredit.value); } catch (e) {}
      syncHudPrefs();
    });
  }
  if (hudNextBoxel) {
    hudNextBoxel.addEventListener("change", function () {
      try { localStorage.setItem(LS_HUD_NEXT_BOXEL, hudNextBoxel.checked ? "1" : "0"); } catch (e) {}
      syncHudPrefs();
    });
  }
  /* The screen marker's window (electron/aimWindow.cjs): kept on through restarts, asked for again at each start. */
  if (hudAim) {
    var aimOn = (function () { try { return localStorage.getItem(LS_HUD_AIM) === "1"; } catch (e) { return false; } })();
    hudAim.checked = aimOn;
    var ee = window.edexoElectron;
    if (!ee || typeof ee.setAimOverlay !== "function") hudAim.disabled = true;
    else if (aimOn) ee.setAimOverlay({ on: true }).catch(function () {});
    hudAim.addEventListener("change", function () {
      try { localStorage.setItem(LS_HUD_AIM, hudAim.checked ? "1" : "0"); } catch (e) {}
      if (ee && typeof ee.setAimOverlay === "function") ee.setAimOverlay({ on: hudAim.checked }).catch(function () {});
    });
  }
  /* The pitch reader (the screen marker's page reads it from the HUD prefs mirror; local capture, aim/pitchCapture.ts). */
  if (hudPitchReader) {
    hudPitchReader.checked = (function () { try { return localStorage.getItem(LS_HUD_PITCH_READER) === "1"; } catch (e) { return false; } })();
    hudPitchReader.addEventListener("change", function () {
      try { localStorage.setItem(LS_HUD_PITCH_READER, hudPitchReader.checked ? "1" : "0"); } catch (e) {}
      syncHudPrefs();
    });
  }
  /* The Scan route's distance reader: opens the screen marker's window without its marks (electron aimWindow.cjs). */
  if (hudDistanceReader) {
    hudDistanceReader.checked = (function () { try { return localStorage.getItem(LS_HUD_DISTANCE_READER) === "1"; } catch (e) { return false; } })();
    if (!window.edexoElectron) hudDistanceReader.disabled = true;
    hudDistanceReader.addEventListener("change", function () {
      try { localStorage.setItem(LS_HUD_DISTANCE_READER, hudDistanceReader.checked ? "1" : "0"); } catch (e) {}
      syncHudPrefs();
    });
  }
  /* HUD colours for the pitch reader: default or the XML's matrix. */
  if (hudColourSel) {
    try { hudColourSel.value = localStorage.getItem(LS_HUD_COLOUR) === "xml" ? "xml" : "default"; } catch (e) {}
    hudColourSel.addEventListener("change", function () {
      try { localStorage.setItem(LS_HUD_COLOUR, hudColourSel.value); } catch (e) {}
      syncHudPrefs();
    });
  }
  if (hudRadarAlways) {
    hudRadarAlways.addEventListener("change", function () {
      try { localStorage.setItem(LS_HUD_RADAR_ALWAYS, hudRadarAlways.checked ? "1" : "0"); } catch (e) {}
      syncHudPrefs();
    });
  }
  if (hudRefuelBar) {
    hudRefuelBar.addEventListener("change", function () {
      try { localStorage.setItem(LS_HUD_REFUEL_BAR, hudRefuelBar.checked ? "1" : "0"); } catch (e) {}
      syncHudPrefs();
    });
  }
  HUD_CZ_PREFS.forEach(function (p) {
    var box = document.getElementById(p.id);
    if (!box) return;
    box.addEventListener("change", function () {
      try { localStorage.setItem(p.ls, box.checked ? "1" : "0"); } catch (e) {}
      syncHudPrefs();
    });
  });
  if (hudCompact) {
    hudCompact.addEventListener("change", function () {
      try { localStorage.setItem(LS_HUD_COMPACT, hudCompact.checked ? "1" : "0"); } catch (e) {}
      syncHudPrefs();
    });
  }
  if (hudRelevant) {
    hudRelevant.addEventListener("change", function () {
      try { localStorage.setItem(LS_HUD_RELEVANT, hudRelevant.checked ? "1" : "0"); } catch (e) {}
      syncHudPrefs();
    });
  }
  if (hudAudio) {
    hudAudio.addEventListener("change", function () {
      try { localStorage.setItem(LS_HUD_AUDIO, hudAudio.checked ? "1" : "0"); } catch (e) {}
      syncHudPrefs();
    });
  }
  if (hudCandOrder) {
    hudCandOrder.addEventListener("change", function () {
      try {
        localStorage.setItem(LS_HUD_CAND, hudCandOrder.value);
      } catch (e) {}
      syncHudPrefs();
    });
  }
  if (hudRegion) {
    hudRegion.addEventListener("change", function () {
      try {
        localStorage.setItem(LS_HUD_REGION, hudRegion.checked ? "1" : "0");
      } catch (e) {}
      syncHudPrefs();
    });
  }
  if (hudCandScanned) {
    hudCandScanned.addEventListener("change", function () {
      try { localStorage.setItem(LS_HUD_CAND_SCANNED, hudCandScanned.value); } catch (e) {}
      syncHudPrefs();
    });
  }
  if (hudCandMax) {
    hudCandMax.addEventListener("change", function () {
      try { localStorage.setItem(LS_HUD_CAND_MAX, hudCandMax.value); } catch (e) {}
      hudCandMax.value = String(readCandMax());
      syncHudPrefs();
    });
  }
  if (hudCandActiveTop) {
    hudCandActiveTop.addEventListener("change", function () {
      try { localStorage.setItem(LS_HUD_CAND_ACTIVE_TOP, hudCandActiveTop.checked ? "1" : "0"); } catch (e) {}
      syncHudPrefs();
    });
  }
  // Set on start, where the old script set it: its value reads another top-level name.
  hudOrder = HUD_SECTION_ORDER.slice();
  if (hudCorner) hudCorner.addEventListener("change", pushLayout);
  if (hudFree && window.edexoElectron && typeof window.edexoElectron.setHudMoveMode === "function") {
    hudFree.addEventListener("change", function () {
      var ee = window.edexoElectron;
      var on = hudFree.checked;
      ee.setHudLayout({ freeOn: on }).then(function () {
        renderFreeMove(on, false);
        // Switching it on is asking to place it: start right away.
        if (on) setHudMoving(true);
      }).catch(function () {});
    });
    if (hudMove) hudMove.addEventListener("click", function () { setHudMoving(!hudMoving); });
  } else if (hudFree) {
    hudFree.closest(".hud-set-row").hidden = true;
  }
  if (hudHideUnfocused && window.edexoElectron && typeof window.edexoElectron.getHudLayout === "function") {
    window.edexoElectron.getHudLayout().then(function (l) {
      hudHideUnfocused.checked = !l || l.hideUnfocused !== false;
    }).catch(function () {});
    hudHideUnfocused.addEventListener("change", function () {
      var ee = window.edexoElectron;
      if (ee && typeof ee.setHudLayout === "function") {
        void ee.setHudLayout({ hideUnfocused: hudHideUnfocused.checked });
      }
    });
  } else if (hudHideUnfocused) {
    hudHideUnfocused.closest(".hud-set-row").hidden = true;
  }
  if (hudVisShow) hudVisShow.addEventListener("click", function () { setHudVisibility(false); });
  if (hudVisHide) hudVisHide.addEventListener("click", function () { setHudVisibility(true); });
  if (window.edexoElectron && typeof window.edexoElectron.onHudVisibility === "function") {
    window.edexoElectron.onHudVisibility(renderHudVisibility);
  }
  if (btnOverlayMenu) btnOverlayMenu.addEventListener("click", function () { void loadHudSettingsIntoModal(); });
  if (ovJump) ovJump.addEventListener("click", function () { void pickOverlay("/jump-overlay.html", HUD_W, 160); });
  if (ovAchievement) {
    ovAchievement.addEventListener("click", function () {
      void pickOverlay("/achievement-overlay.html", HUD_W, 220);
    });
  }
  if (ovNotable) ovNotable.addEventListener("click", function () { void pickOverlay("/notable-overlay.html", HUD_W, 160); });
  if (ovNotices) ovNotices.addEventListener("click", function () { void pickOverlay("/notices-overlay.html", HUD_W, 140); });
  if (ovColonize) ovColonize.addEventListener("click", function () { void pickOverlay("/colonize-overlay.html", HUD_W, 260); });
  if (ovShip) ovShip.addEventListener("click", function () { void pickOverlay("/ship-overlay.html", HUD_W, 300); });
  if (ovCarrier) ovCarrier.addEventListener("click", function () { void pickOverlay("/carrier-overlay.html", HUD_W, 140); });
}
