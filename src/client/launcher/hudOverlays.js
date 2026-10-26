/*
  The HUD overlays: separate windows or one merged panel, which sections are open, the phone HUD's sections, and Elite's display mode warning.
  Split out of public/launcher.js (discuss item 19, 1.3.1).
*/
import { btnOverlayMenu, launcherActionMsg, ovDataValue, ovExoCandidates, ovExoDistance, ovFssScan, overlayPickClose, overlayPickModal } from "./status.js";
import { webOriginBase } from "./exomastery.js";
import { HUD_SECTION_KEYS } from "@shared/hudSections";
import { hudOrder, syncHudPrefs } from "./hudSettings.js";

/*
  Two ways to show the same four HUDs: separate click-through windows, or one merged window
  (/hud-overlay.html?s=…) whose sections are named in its query string. The merge checkbox
  picks the form; the four rows toggle the same content either way. Every window asks for
  the same width so the stack lines up.
*/
export var HUD_W = 404;
export var HUD_MERGED = "/hud-overlay.html";
export var HUD_SECTION_BY_PATH = {
  "/jump-overlay.html": "jump",
  "/fss-scan-overlay.html": "fss",
  "/exo-candidates-overlay.html": "candidates",
  "/distance-overlay.html": "distance",
  "/data-value-overlay.html": "datavalue",
  "/achievement-overlay.html": "achievement",
  "/notable-overlay.html": "notable",
  "/notices-overlay.html": "notices",
  "/colonize-overlay.html": "colonize",
  "/ship-overlay.html": "ship",
};
// The HUD's own list and order (shared/hudSections.ts); the launcher kept a copy of it until 1.3.1.
export var HUD_SECTION_ORDER = HUD_SECTION_KEYS.slice();
export var HUD_SECTION_LABEL = {
  jump: "Next jump",
  fss: "Discovery scan",
  candidates: "Exo candidates",
  distance: "Exo-distance tracker",
  datavalue: "Data value",
  achievement: "Achievement",
  notable: "Notable planets",
  notices: "Notices",
  colonize: "Colonize",
  ship: "Ship",
};
export var HUD_PATH_BY_SECTION = {};
var LS_HUD_MERGE = "edexoHudMerge";
var ovMerge = document.getElementById("ovMerge");
export function hudMergeOn() {
  try {
    return localStorage.getItem(LS_HUD_MERGE) === "1";
  } catch (e) {
    return false;
  }
}
export async function hudPaths() {
  var ee = window.edexoElectron;
  try {
    if (ee && typeof ee.getHudOverlayState === "function") {
      var st = await ee.getHudOverlayState();
      return (st && st.paths) || [];
    }
  } catch (e) {
    /* fall through */
  }
  return [];
}
function mergedSections(paths) {
  for (var i = 0; i < paths.length; i++) {
    var p = String(paths[i]);
    if (p.indexOf(HUD_MERGED) !== 0) continue;
    var m = /[?&]s=([^&]*)/.exec(p);
    if (!m) return HUD_SECTION_ORDER.slice();
    return decodeURIComponent(m[1]).split(",").filter(function (s) {
      return HUD_SECTION_ORDER.indexOf(s) >= 0;
    });
  }
  return [];
}
/** Sections active right now, in either form. */
export function activeSections(paths) {
  var out = mergedSections(paths);
  Object.keys(HUD_SECTION_BY_PATH).forEach(function (p) {
    if (paths.indexOf(p) >= 0 && out.indexOf(HUD_SECTION_BY_PATH[p]) < 0) out.push(HUD_SECTION_BY_PATH[p]);
  });
  return HUD_SECTION_ORDER.filter(function (s) {
    return out.indexOf(s) >= 0;
  });
}
/*
  One HUD change at a time (owner, 2026-10-05: "Merge into one panel does not save what was
  selected when I click it twice"). Each change reads which sections are open from the windows that
  exist, so a second click while the first was still opening and closing windows read a half-made
  set (hud-events.log: the merged panel came back with Discovery scan and Next jump only). Queued,
  each change starts from the finished state of the one before.
*/
var hudChain = Promise.resolve();
export function inHudQueue(task) {
  var run = hudChain.then(task);
  hudChain = run.catch(function () {});
  return run;
}

export async function showSections(sections) {
  var ee = window.edexoElectron;
  if (!ee) return;
  var paths = await hudPaths();
  if (hudMergeOn()) {
    for (var i = 0; i < paths.length; i++) {
      if (HUD_SECTION_BY_PATH[paths[i]] && typeof ee.closeHudOverlay === "function") {
        await ee.closeHudOverlay({ pathname: paths[i] });
      }
    }
    if (!sections.length) {
      if (typeof ee.closeHudOverlay === "function") await ee.closeHudOverlay({ pathname: HUD_MERGED });
    } else if (typeof ee.setHudOverlay === "function") {
      var ordered = (typeof hudOrder !== "undefined" ? hudOrder : HUD_SECTION_ORDER).filter(function (x) {
        return sections.indexOf(x) >= 0;
      });
      var r = await ee.setHudOverlay({
        pathname: HUD_MERGED + "?s=" + ordered.join(","),
        width: HUD_W,
        height: 330,
      });
      if (r && r.error) throw new Error(r.error);
    }
  } else {
    if (typeof ee.closeHudOverlay === "function") await ee.closeHudOverlay({ pathname: HUD_MERGED });
    var want = {};
    sections.forEach(function (s) {
      want[s] = true;
    });
    for (var p in HUD_SECTION_BY_PATH) {
      var open = paths.indexOf(p) >= 0;
      var should = !!want[HUD_SECTION_BY_PATH[p]];
      if (open !== should && typeof ee.toggleHudOverlay === "function") {
        var rt = await ee.toggleHudOverlay({ pathname: p, width: HUD_W, height: 330 });
        if (rt && rt.error) throw new Error(rt.error);
      }
    }
  }
}

async function refreshOverlayMenuChecks() {
  var paths = await hudPaths();
  var active = activeSections(paths);
  document.querySelectorAll("[data-overlay-path]").forEach(function (btn) {
    var p = btn.getAttribute("data-overlay-path");
    if (!p) return;
    var on = active.indexOf(HUD_SECTION_BY_PATH[p]) >= 0;
    btn.classList.toggle("overlay-btn--on", on);
    var mark = btn.querySelector(".overlay-check");
    if (mark) mark.textContent = on ? "✓" : "";
  });
  if (ovMerge) ovMerge.checked = hudMergeOn();
  void refreshPhoneSections();
}

/*
  The phone HUD shows what the app has open, in the app's stack order (owner, 2026-10-15: it showed every section
  in its own order). Read from the windows that exist, so a HUD opened or closed any way — the picker, merge, the
  windows restored at start — reaches the phone on the next look; sent with the other HUD settings.
*/
export var hudPhoneSections = null;
export async function refreshPhoneSections() {
  var ee = window.edexoElectron;
  if (!ee || typeof ee.getHudOverlayState !== "function") return;
  var order = typeof hudOrder !== "undefined" && hudOrder ? hudOrder : HUD_SECTION_ORDER;
  try {
    if (typeof ee.getHudLayout === "function") {
      var lay = await ee.getHudLayout();
      if (lay && Array.isArray(lay.order) && lay.order.length) {
        var secs = lay.order.map(function (k) { return HUD_SECTION_BY_PATH[k]; }).filter(Boolean);
        order = secs.concat(HUD_SECTION_ORDER.filter(function (s) { return secs.indexOf(s) < 0; }));
      }
    }
  } catch (e) {
    /* the launcher's own list */
  }
  var active = activeSections(await hudPaths());
  var list = order.filter(function (s) {
    return active.indexOf(s) >= 0;
  });
  if (hudPhoneSections && hudPhoneSections.join(",") === list.join(",")) return;
  hudPhoneSections = list;
  syncHudPrefs();
}

async function toggleHudOverlayPath(pathname, width, height) {
  launcherActionMsg.className = "msg-launcher";
  launcherActionMsg.textContent = "";
  var ee = window.edexoElectron;
  if (ee && typeof ee.toggleHudOverlay === "function") {
    var rOv = await ee.toggleHudOverlay({ pathname: pathname, width: width, height: height });
    if (rOv && rOv.error) throw new Error(rOv.error);
    await refreshOverlayMenuChecks();
    return;
  }
  var base = webOriginBase();
  var name = "edexoHud" + String(pathname).replace(/[^\w-]+/g, "_");
  window.open(
    base + pathname,
    name,
    "noopener,noreferrer,width=" + width + ",height=" + height,
  );
}

export function pickOverlay(pathname, width, height) {
  return inHudQueue(function () {
    return pickOverlayNow(pathname, width, height);
  });
}

async function pickOverlayNow(pathname, width, height) {
  // The picker stays open: with five HUDs and the settings below, one pick per open was a chore.
  try {
    var ee = window.edexoElectron;
    var sec = HUD_SECTION_BY_PATH[pathname];
    if (ee && sec && typeof ee.setHudOverlay === "function") {
      var active = activeSections(await hudPaths());
      var idx = active.indexOf(sec);
      if (idx >= 0) active.splice(idx, 1);
      else active.push(sec);
      await showSections(
        HUD_SECTION_ORDER.filter(function (s) {
          return active.indexOf(s) >= 0;
        }),
      );
      await refreshOverlayMenuChecks();
      return;
    }
    await toggleHudOverlayPath(pathname, width, height);
  } catch (eOv) {
    launcherActionMsg.className = "msg-launcher err";
    launcherActionMsg.textContent = String(eOv && eOv.message ? eOv.message : eOv);
  }
}

/*
  Elite's display mode decides whether a HUD can be seen at all: an always-on-top window
  draws over a borderless game and cannot draw over an exclusive fullscreen one, which is a
  Windows rule and not something this app can work around. The server reads the game's own
  DisplaySettings.xml, so this says nothing unless the file actually says Fullscreen -- a
  commander whose Elite lives somewhere this cannot find is not warned on a guess.

  Asked on every open rather than once at boot: he changes the setting mid-session, and that
  is exactly when he comes looking for this menu.
*/
function refreshDisplayModeWarning() {
  var el = document.getElementById("hudDisplayWarn");
  if (!el) return;
  fetch("/api/elite-display-mode")
    .then(function (r) {
      return r.ok ? r.json() : null;
    })
    .then(function (j) {
      var msg = j && typeof j.warning === "string" ? j.warning : "";
      el.textContent = msg;
      el.hidden = !msg;
    })
    .catch(function () {
      el.hidden = true;
    });
}

/** What ran when the page loaded, in the order it ran (main.js calls each module's in the file's old order). */
export function start() {
  Object.keys(HUD_SECTION_BY_PATH).forEach(function (p) {
    HUD_PATH_BY_SECTION[HUD_SECTION_BY_PATH[p]] = p;
  });
  setTimeout(function () {
    void refreshPhoneSections();
  }, 3000);
  setInterval(function () {
    void refreshPhoneSections();
  }, 10000);

  if (ovMerge) {
    ovMerge.checked = hudMergeOn();
    ovMerge.addEventListener("change", function () {
      try {
        localStorage.setItem(LS_HUD_MERGE, ovMerge.checked ? "1" : "0");
      } catch (e) {
        /* ignore */
      }
      // Re-show whatever is open in the newly chosen form, after any change still under way.
      var wantMerge = ovMerge.checked;
      void inHudQueue(async function () {
        try {
          // A later click may have flipped it back while this waited: follow the box as it is now.
          if (ovMerge.checked !== wantMerge) return;
          var active = activeSections(await hudPaths());
          if (active.length) await showSections(active);
          await refreshOverlayMenuChecks();
        } catch (eM) {
          launcherActionMsg.className = "msg-launcher err";
          launcherActionMsg.textContent = String(eM && eM.message ? eM.message : eM);
        }
      });
    });
  }

  if (btnOverlayMenu && overlayPickModal) {
    btnOverlayMenu.addEventListener("click", function () {
      overlayPickModal.classList.add("on");
      void refreshOverlayMenuChecks();
      refreshDisplayModeWarning();
    });
  }
  if (overlayPickClose && overlayPickModal) {
    overlayPickClose.addEventListener("click", function () {
      overlayPickModal.classList.remove("on");
    });
  }
  if (overlayPickModal) {
    overlayPickModal.addEventListener("click", function (e) {
      if (e.target === overlayPickModal) overlayPickModal.classList.remove("on");
    });
  }
  if (ovExoDistance) {
    ovExoDistance.addEventListener("click", function () {
      void pickOverlay("/distance-overlay.html", HUD_W, 330);
    });
  }
  if (ovFssScan) {
    ovFssScan.addEventListener("click", function () {
      void pickOverlay("/fss-scan-overlay.html", HUD_W, 212);
    });
  }
  if (ovExoCandidates) {
    ovExoCandidates.addEventListener("click", function () {
      void pickOverlay("/exo-candidates-overlay.html", HUD_W, 480);
    });
  }
  if (ovDataValue) {
    ovDataValue.addEventListener("click", function () {
      void pickOverlay("/data-value-overlay.html", HUD_W, 268);
    });
  }
}
