/*
  The Exomastery button and menu: refresh, downloads of the commander's own exomastery and codex, the shared folder.
  Split out of public/launcher.js (discuss item 19, 1.3.1).
*/
import { btnExomasteryRefresh, launcherActionMsg } from "./status.js";
import { apiUrl, lastPort } from "./network.js";

/*
  Exomastery menu (owner, 2026-09-26): the main button still refreshes; the arrow offers the
  downloads and the shared folder. The line under the title says what the shared folder holds.
*/
var exomasteryMenu = document.getElementById("exomasteryMenu");
var btnExomasteryMenu = document.getElementById("btnExomasteryMenu");
var exomasterySplit = document.getElementById("exomasterySplit");
var exomasterySub = document.getElementById("exomasterySub");
var EXO_SUB_DEFAULT;

function closeExomasteryMenu() {
  exomasteryMenu.hidden = true;
  btnExomasteryMenu.setAttribute("aria-expanded", "false");
}

function refreshSharedLine() {
  fetch(apiUrl("/api/exomastery/shared"))
    .then(function (r) {
      return r.ok ? r.json() : null;
    })
    .then(function (j) {
      if (!j || !exomasterySub) return;
      var used = (j.files || []).filter(function (f) {
        return !f.skipped;
      }).length;
      var skipped = (j.files || []).length - used;
      if (used === 0 && skipped === 0) {
        exomasterySub.textContent = EXO_SUB_DEFAULT;
        return;
      }
      var parts = ["Shared: " + used + " file" + (used === 1 ? "" : "s")];
      if (j.finds > 0) {
        parts.push(
          j.finds.toLocaleString() + " finds from " + j.commanders + " commander" + (j.commanders === 1 ? "" : "s"),
        );
      }
      if (j.ownBackupFinds > 0) parts.push("your backup: " + j.ownBackupFinds.toLocaleString());
      if (skipped > 0) parts.push(skipped + " skipped");
      if (j.alerts > 0) parts.push(j.alerts + " gate notice" + (j.alerts === 1 ? "" : "s") + " (mail icon)");
      exomasterySub.textContent = parts.join(" · ");
      exomasterySub.title = (j.files || [])
        .map(function (f) {
          return f.file + (f.skipped ? " — skipped: " + f.skipped : " — " + (f.commander || "?") + ", " + f.entries);
        })
        .join("\n");
    })
    .catch(function () {
      /* the default line stays */
    });
}

function exomasteryDownload(kind) {
  launcherActionMsg.className = "msg-launcher";
  launcherActionMsg.textContent = "";
  var bridge = window.edexoElectron;
  fetch(apiUrl("/api/exomastery/export?kind=" + kind))
    .then(function (r) {
      if (!r.ok) throw new Error(r.statusText);
      var cd = r.headers.get("Content-Disposition") || "";
      var m = /filename="([^"]+)"/.exec(cd);
      var name = m ? m[1] : "EDEXO-" + kind + ".json";
      return r.text().then(function (text) {
        return { name: name, text: text };
      });
    })
    .then(function (x) {
      if (bridge && typeof bridge.saveTextFile === "function") {
        return bridge.saveTextFile({ defaultName: x.name, text: x.text }).then(function (res) {
          if (res && res.saved) {
            launcherActionMsg.className = "msg-launcher ok";
            launcherActionMsg.textContent = "Saved " + res.path;
          }
        });
      }
      // The launcher in a browser: an ordinary download.
      var url = URL.createObjectURL(new Blob([x.text], { type: "application/json" }));
      var a = document.createElement("a");
      a.href = url;
      a.download = x.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () {
        URL.revokeObjectURL(url);
      }, 5000);
    })
    .catch(function (e) {
      launcherActionMsg.className = "msg-launcher err";
      launcherActionMsg.textContent = "Could not download: " + String(e && e.message ? e.message : e);
    });
}

function openSharedFolder() {
  fetch(apiUrl("/api/exomastery/open-shared-folder"), { method: "POST" })
    .then(function (r) {
      return r.json();
    })
    .then(function (j) {
      if (!j || !j.ok) throw new Error((j && j.error) || "Could not open the folder.");
      launcherActionMsg.className = "msg-launcher ok";
      launcherActionMsg.textContent =
        "Shared folder: " + j.folder + " — drop exomastery or codex files in, then Refresh exomastery.";
    })
    .catch(function (e) {
      launcherActionMsg.className = "msg-launcher err";
      launcherActionMsg.textContent = String(e && e.message ? e.message : e);
    });
}

export function webOriginBase() {
  var proto = window.location.protocol || "";
  if (proto === "http:" || proto === "https:") return window.location.origin;
  return "http://127.0.0.1:" + (lastPort || 7111);
}

/** What ran when the page loaded, in the order it ran (main.js calls each module's in the file's old order). */
export function start() {
  // Set on start, where the old script set it: its value reads another top-level name.
  EXO_SUB_DEFAULT = exomasterySub ? exomasterySub.textContent : "";

  btnExomasteryMenu.addEventListener("click", function (ev) {
    ev.stopPropagation();
    var open = exomasteryMenu.hidden;
    exomasteryMenu.hidden = !open;
    btnExomasteryMenu.setAttribute("aria-expanded", open ? "true" : "false");
  });
  exomasteryMenu.addEventListener("click", function (ev) {
    var item = ev.target.closest("button[data-exo-action]");
    if (!item) return;
    closeExomasteryMenu();
    var act = item.dataset.exoAction;
    if (act === "refresh") btnExomasteryRefresh.click();
    else if (act === "export-exomastery") exomasteryDownload("exomastery");
    else if (act === "export-codex") exomasteryDownload("codex");
    else if (act === "open-shared") openSharedFolder();
    // "import-dump" and "import-visited" open their panels from their own listeners (below).
  });
  document.addEventListener("click", function (ev) {
    if (!exomasteryMenu.hidden && !exomasterySplit.contains(ev.target)) closeExomasteryMenu();
  });
  document.addEventListener("keydown", function (ev) {
    if (ev.key === "Escape" && !exomasteryMenu.hidden) closeExomasteryMenu();
  });
  refreshSharedLine();

  btnExomasteryRefresh.addEventListener("click", function () {
    launcherActionMsg.className = "msg-launcher";
    launcherActionMsg.textContent = "";
    btnExomasteryRefresh.disabled = true;
    fetch(apiUrl("/api/exomastery/reload"), { method: "POST" })
      .then(function (r) {
        return r.json().then(function (j) {
          return { r: r, j: j };
        });
      })
      .then(function (x) {
        if (!x.r.ok) throw new Error((x.j && x.j.error) || x.r.statusText);
        launcherActionMsg.className = "msg-launcher ok";
        var j = x.j || {};
        var sd = j.speciesDataDir ? String(j.speciesDataDir) : "";
        launcherActionMsg.textContent =
          "Exomastery cache cleared; species tree re-read from disk — linked UI refreshes over WebSocket." +
          (sd
            ? " Species / exomastery folder: " + sd
            : "");
      })
      .catch(function (e) {
        launcherActionMsg.className = "msg-launcher err";
        launcherActionMsg.textContent = String(e && e.message ? e.message : e);
      })
      .then(function () {
        btnExomasteryRefresh.disabled = false;
        refreshSharedLine();
      });
  });
}
