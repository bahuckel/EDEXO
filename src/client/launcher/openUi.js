/*
  Open Compare and Open Colonize: where each opens (app window, browser), their menus, and the streamer view links.
  Split out of public/launcher.js (discuss item 19, 1.3.1).
*/
import { btnColonize, btnColonizeSub, btnMainUi, btnMainUiMenu, btnMainUiSub, launcherActionMsg, mainUiMenu, mainUiSplit } from "./status.js";
import { LS_OPEN_MODE, apiUrl, lastPort } from "./network.js";

/*
  Where "Open Compare" opens (owner's launcher request). Colonize has its own choice (COLONIZE_MODES below).

  Three destinations, one remembered choice, browser by default. The old button navigated
  this window to the app, which left no way back to the launcher short of restarting it. That
  became "This window", and then (owner, 2026-09-26) "App window": the same app in a window of
  its own, so closing it leaves the launcher where it was. The stored value is still "window".

  Opening the system browser needs the server: window.open inside Electron makes another
  Electron window, not a browser. The route takes a two-value enum rather than a URL, so it
  can only ever open this app's own views.
*/
var OPEN_MODES = {
  browser: { sub: "In your browser", view: "app" },
  window: { sub: "In an app window", view: null },
  phone: { sub: "Phone view — read-only triage", view: "phone" },
};

function readOpenMode() {
  try {
    var v = localStorage.getItem(LS_OPEN_MODE);
    if (v && OPEN_MODES[v]) return v;
  } catch (e) {
    /* private window, or storage disabled — the default is still correct */
  }
  // The app window by default (owner, 2026-10-22: "in-app, default on top"); it was the browser.
  return "window";
}

function applyOpenMode(mode) {
  btnMainUiSub.textContent = OPEN_MODES[mode].sub;
  var items = mainUiMenu.querySelectorAll("button[data-open-mode]");
  for (var i = 0; i < items.length; i++) {
    items[i].setAttribute("aria-current", items[i].dataset.openMode === mode ? "true" : "false");
  }
}

function setOpenMode(mode) {
  try {
    localStorage.setItem(LS_OPEN_MODE, mode);
  } catch (e) {
    /* the choice still applies for this session */
  }
  applyOpenMode(mode);
  // And in user data, where a rebuilt or moved exe still finds it (localStorage lives in the
  // Chromium profile, which is not the commander's data folder).
  fetch(apiUrl("/api/launcher/open-mode"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode: mode }),
  }).catch(function () {
    /* localStorage still has it */
  });
}

/* The saved choice wins over this profile's localStorage; a launcher with no route keeps the local one. */
function loadSavedOpenMode() {
  fetch(apiUrl("/api/launcher/open-mode"))
    .then(function (r) {
      return r.ok ? r.json() : null;
    })
    .then(function (j) {
      if (!j || !j.mode || !OPEN_MODES[j.mode]) {
        // Nothing saved yet: carry this profile's choice over once, so an upgrade keeps it.
        var local = readOpenMode();
        if (j && j.ok && local !== "window") setOpenMode(local);
        return;
      }
      try {
        localStorage.setItem(LS_OPEN_MODE, j.mode);
      } catch (e) {
        /* fine */
      }
      applyOpenMode(j.mode);
    })
    .catch(function () {
      /* offline server: the local choice stands */
    });
}

function closeOpenMenu() {
  mainUiMenu.hidden = true;
  btnMainUiMenu.setAttribute("aria-expanded", "false");
}

function openChosenUi() {
  var mode = readOpenMode();
  if (mode === "window") {
    var bridge = window.edexoElectron;
    if (bridge && typeof bridge.openAppWindow === "function") {
      bridge.openAppWindow().then(
        function (r) {
          if (r && r.opened) return;
          launcherActionMsg.className = "msg-launcher err";
          launcherActionMsg.textContent = "Could not open the app window" + (r && r.error ? ": " + r.error : ".");
        },
        function (e) {
          launcherActionMsg.className = "msg-launcher err";
          launcherActionMsg.textContent = "Could not open the app window: " + String(e && e.message ? e.message : e);
        },
      );
    } else {
      // The launcher in a browser (CLI server): a new tab is the nearest thing to a window.
      window.open("/", "_blank", "noopener");
    }
    return;
  }
  launcherActionMsg.className = "msg-launcher";
  launcherActionMsg.textContent = "";
  fetch(apiUrl("/api/ui/open-external"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ view: OPEN_MODES[mode].view }),
  })
    .then(function (r) {
      return r.json().then(function (j) {
        return { r: r, j: j };
      });
    })
    .then(function (x) {
      if (!x.r.ok || !x.j.ok) throw new Error((x.j && x.j.error) || x.r.statusText);
    })
    .catch(function (e) {
      /*
        Falling back rather than failing: on a build with no such route the commander still
        gets their UI, in a new tab, which is the nearest honest thing to what they asked
        for.
      */
      window.open(mode === "phone" ? "/?screen=triage" : "/", "_blank", "noopener");
      launcherActionMsg.className = "msg-launcher";
      launcherActionMsg.textContent = "Opened in a new tab (" + String(e && e.message ? e.message : e) + ")";
    });
}

/*
  Where "Open Colonize" opens: its own choice, remembered apart from Compare's (owner, 2026-10-22: choosing Phone for
  Compare opened Compare's phone view, then Colonize had to be clicked again). Same three destinations; the streamer
  view is an action in its menu, as Compare's is.
*/
var LS_COLONIZE_OPEN_MODE = "edexo.launcher.colonizeOpenMode";
var COLONIZE_MODES = {
  browser: { sub: "Your construction sites and the haul plan · in your browser", view: "colonize", page: "/?screen=colonize" },
  window: { sub: "Your construction sites and the haul plan · in an app window", view: null, page: "/?screen=colonize" },
  phone: { sub: "Phone view — read-only sites and plan", view: "colonize-phone", page: "/?screen=colonize&phone=1" },
};
var colonizeSplit = document.getElementById("colonizeSplit");
var btnColonizeMenu = document.getElementById("btnColonizeMenu");
var colonizeMenu = document.getElementById("colonizeMenu");

function readColonizeOpenMode() {
  try {
    var v = localStorage.getItem(LS_COLONIZE_OPEN_MODE);
    if (v && COLONIZE_MODES[v]) return v;
  } catch (e) {
    /* private window, or storage disabled — the default is still correct */
  }
  return "window";
}

function applyColonizeOpenMode(mode) {
  if (btnColonizeSub) btnColonizeSub.textContent = COLONIZE_MODES[mode].sub;
  if (!colonizeMenu) return;
  var items = colonizeMenu.querySelectorAll("button[data-colonize-mode]");
  for (var i = 0; i < items.length; i++) {
    items[i].setAttribute("aria-current", items[i].dataset.colonizeMode === mode ? "true" : "false");
  }
}

function setColonizeOpenMode(mode) {
  try {
    localStorage.setItem(LS_COLONIZE_OPEN_MODE, mode);
  } catch (e) {
    /* the choice still applies for this session */
  }
  applyColonizeOpenMode(mode);
  fetch(apiUrl("/api/launcher/open-mode?app=colonize"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode: mode }),
  }).catch(function () {
    /* localStorage still has it */
  });
}

/* The choice saved in user data wins; a server without it (or none saved yet) keeps this profile's. */
function loadSavedColonizeOpenMode() {
  fetch(apiUrl("/api/launcher/open-mode?app=colonize"))
    .then(function (r) {
      return r.ok ? r.json() : null;
    })
    .then(function (j) {
      if (!j || !j.mode || !COLONIZE_MODES[j.mode]) return;
      try {
        localStorage.setItem(LS_COLONIZE_OPEN_MODE, j.mode);
      } catch (e) {
        /* fine */
      }
      applyColonizeOpenMode(j.mode);
    })
    .catch(function () {
      /* offline server: the local choice stands */
    });
}

function closeColonizeMenu() {
  if (!colonizeMenu) return;
  colonizeMenu.hidden = true;
  if (btnColonizeMenu) btnColonizeMenu.setAttribute("aria-expanded", "false");
}

function openColonize() {
  var bridge = window.edexoElectron;
  var mode = readColonizeOpenMode();
  var failed = function (e) {
    launcherActionMsg.className = "msg-launcher err";
    launcherActionMsg.textContent = "Could not open Colonize" + (e ? ": " + String(e && e.message ? e.message : e) : ".");
  };
  if (mode === "window") {
    if (bridge && typeof bridge.openColonizeWindow === "function") {
      bridge.openColonizeWindow().then(function (r) {
        if (!r || !r.opened) failed(r && r.error);
      }, failed);
    } else {
      window.open("/?screen=colonize", "_blank", "noopener");
    }
    return;
  }
  launcherActionMsg.className = "msg-launcher";
  launcherActionMsg.textContent = "";
  fetch(apiUrl("/api/ui/open-external"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ view: COLONIZE_MODES[mode].view }),
  })
    .then(function (r) {
      return r.json().then(function (j) {
        if (!r.ok || !j.ok) throw new Error((j && j.error) || r.statusText);
      });
    })
    .catch(function (e) {
      window.open(COLONIZE_MODES[mode].page, "_blank", "noopener");
      launcherActionMsg.className = "msg-launcher";
      launcherActionMsg.textContent = "Opened in a new tab (" + String(e && e.message ? e.message : e) + ")";
    });
}
/* Colonize's streamer view: the plan for an OBS Browser source, nothing clickable (owner, 2026-10-22). */
var btnColonizeStreamLink = document.getElementById("btnColonizeStreamLink");
/*
  Streamer view (owner, 2026-10-01): the main UI with every control taken away (?view=stream),
  for a Browser source in OBS on this PC. The link is copied for OBS, and (owner, 2026-10-04: "does
  not open") the view opens in the browser too, so what the viewers will see is on screen at once.
*/
var btnStreamLink = document.getElementById("btnStreamLink");

/** What ran when the page loaded, in the order it ran (main.js calls each module's in the file's old order). */
export function start() {

  applyOpenMode(readOpenMode());
  loadSavedOpenMode();
  applyColonizeOpenMode(readColonizeOpenMode());
  loadSavedColonizeOpenMode();
  btnMainUi.addEventListener("click", openChosenUi);
  if (btnColonize) btnColonize.addEventListener("click", openColonize);
  if (btnColonizeMenu && colonizeMenu) {
    btnColonizeMenu.addEventListener("click", function (ev) {
      ev.stopPropagation();
      // The other app's menu closes: stopPropagation kept its click-outside from seeing this (review 2026-10-24).
      if (!mainUiMenu.hidden) closeOpenMenu();
      var open = colonizeMenu.hidden;
      colonizeMenu.hidden = !open;
      btnColonizeMenu.setAttribute("aria-expanded", open ? "true" : "false");
    });
    colonizeMenu.addEventListener("click", function (ev) {
      var item = ev.target.closest("button[data-colonize-mode]");
      if (!item) return;
      setColonizeOpenMode(item.dataset.colonizeMode);
      closeColonizeMenu();
      // As Compare's menu: choosing is also asking for it (owner, 2026-10-22).
      openColonize();
    });
    document.addEventListener("click", function (ev) {
      if (!colonizeMenu.hidden && !colonizeSplit.contains(ev.target)) closeColonizeMenu();
    });
    document.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape" && !colonizeMenu.hidden) closeColonizeMenu();
    });
  }
  if (btnColonizeStreamLink) btnColonizeStreamLink.addEventListener("click", function () {
    closeColonizeMenu();
    var url = "http://127.0.0.1:" + (lastPort || 7111) + "/?screen=colonize&view=stream";
    var say = function (copied) {
      launcherActionMsg.className = "msg-launcher";
      launcherActionMsg.textContent =
        (copied ? "Copied: " : "Colonize streamer view: ") + url +
        " — in OBS add a Browser source with this URL. It follows your sites, the hold and the plan's ticks." +
        " Add &zoom=1.25 to scale it, &bg=transparent to drop the backdrop.";
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(function () { say(true); }, function () { say(false); });
    } else {
      say(false);
    }
    fetch(apiUrl("/api/ui/open-external"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ view: "colonize-stream" }),
    })
      .then(function (r) {
        if (!r.ok) throw new Error(String(r.status));
      })
      .catch(function () {
        window.open("/?screen=colonize&view=stream", "_blank", "noopener");
      });
  });
  btnMainUiMenu.addEventListener("click", function (ev) {
    ev.stopPropagation();
    if (colonizeMenu && !colonizeMenu.hidden) closeColonizeMenu();
    var open = mainUiMenu.hidden;
    mainUiMenu.hidden = !open;
    btnMainUiMenu.setAttribute("aria-expanded", open ? "true" : "false");
  });
  if (btnStreamLink) btnStreamLink.addEventListener("click", function () {
    closeOpenMenu();
    var url = "http://127.0.0.1:" + (lastPort || 7111) + "/?view=stream";
    var say = function (copied) {
      launcherActionMsg.className = "msg-launcher";
      launcherActionMsg.textContent =
        (copied ? "Copied: " : "Streamer view: ") + url +
        " — in OBS add a Browser source with this URL (1280×800 or larger). It follows the game and your body-tab keys." +
        " Add &cmdr=0 to hide your name, &zoom=1.25 to scale it, &bg=transparent to drop the backdrop.";
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(function () { say(true); }, function () { say(false); });
    } else {
      say(false);
    }
    fetch(apiUrl("/api/ui/open-external"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ view: "stream" }),
    })
      .then(function (r) {
        if (!r.ok) throw new Error(String(r.status));
      })
      .catch(function () {
        // A launcher in a browser (CLI server), or an older server: a new tab shows it instead.
        window.open("/?view=stream", "_blank", "noopener");
      });
  });
  mainUiMenu.addEventListener("click", function (ev) {
    var item = ev.target.closest("button[data-open-mode]");
    if (!item) return;
    setOpenMode(item.dataset.openMode);
    closeOpenMenu();
    // Choosing is also asking for it: nobody opens this menu to browse it.
    openChosenUi();
  });
  document.addEventListener("click", function (ev) {
    if (!mainUiMenu.hidden && !mainUiSplit.contains(ev.target)) closeOpenMenu();
  });
  document.addEventListener("keydown", function (ev) {
    if (ev.key === "Escape" && !mainUiMenu.hidden) closeOpenMenu();
  });
}
