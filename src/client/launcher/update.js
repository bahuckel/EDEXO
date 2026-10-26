/*
  The version line and the updater: check for a newer release, and where this copy can replace itself, Download & Install.
  Split out of public/launcher.js (discuss item 19, 1.3.1).
*/
import { apiUrl } from "./network.js";

/*
  The version line. Asked once when the launcher opens (the server remembers GitHub's answer
  for an hour), and again on the button. When a newer release exists the button becomes its
  download link: the server opens that release's page itself — the page, never a file, and
  nothing on this PC is replaced by the app.
*/
const versionLine = document.getElementById("versionLine");
const versionText = document.getElementById("versionText");
const btnCheckUpdate = document.getElementById("btnCheckUpdate");
const btnUpdatePage = document.getElementById("btnUpdatePage");
var updateInfo = null;
var updatePoll = null;
/* Set by the button: install as soon as the download is checked (owner: "Download & Install"). */
var installWhenReady = false;
/*
  The updater (owner, 2026-10-02): where this copy can replace itself (download.supported), one
  button, "Download & Install", downloads the newer release, checks it against GitHub's SHA-256,
  and then installs it: the app closes, the new copy goes in, and it starts. Only on that press,
  never by itself. The release page stays one click away. Elsewhere (a source run, the console
  builds) the button opens the page as before.
*/
function canSelfUpdate(info) {
  return Boolean(
    info && info.newer && info.download && info.download.supported &&
      window.edexoElectron && typeof window.edexoElectron.installUpdate === "function",
  );
}

function renderUpdateInfo(info, checking) {
  updateInfo = info;
  var cur = info && info.current ? "v" + info.current : "Version —";
  versionLine.classList.toggle("newer", Boolean(info && info.newer));
  btnCheckUpdate.disabled = Boolean(checking);
  btnUpdatePage.hidden = !(info && info.newer && canSelfUpdate(info));
  if (checking) {
    versionText.textContent = cur + " · checking…";
    btnCheckUpdate.textContent = "Check for updates";
    return;
  }
  if (canSelfUpdate(info)) {
    var dl = info.download;
    versionText.title = "";
    btnCheckUpdate.title = "";
    if (dl.state === "downloading") {
      var pct = dl.total ? Math.floor((100 * dl.received) / dl.total) : null;
      versionText.textContent = "Installed " + cur + " · downloading v" + info.latest + (pct != null ? " · " + pct + " %" : "…");
      btnCheckUpdate.textContent = "Downloading…";
      btnCheckUpdate.disabled = true;
    } else if (dl.state === "ready" && installWhenReady) {
      versionText.textContent = "Installed " + cur + " · installing v" + info.latest + "…";
      btnCheckUpdate.textContent = "Installing…";
      btnCheckUpdate.disabled = true;
    } else {
      versionText.textContent =
        "Installed " + cur + " · v" + info.latest + " available" +
        (dl.state === "error" ? " · download failed" : dl.error ? " · last install failed" : "");
      if (dl.error) versionText.title = dl.error;
      btnCheckUpdate.textContent = dl.state === "error" ? "Try again" : "Download & Install v" + info.latest;
      btnCheckUpdate.title =
        "Downloads v" + info.latest + " from GitHub, checks it, then closes the app, puts it in place of this copy and starts it. Your settings and data are kept.";
    }
    return;
  }
  if (info && info.newer) {
    versionText.textContent = "Installed " + cur + " · v" + info.latest + " available";
    btnCheckUpdate.textContent = "Download v" + info.latest;
    btnCheckUpdate.title = "Opens the release page on GitHub in your browser.";
    return;
  }
  btnCheckUpdate.textContent = "Check for updates";
  btnCheckUpdate.title = "";
  if (info && info.error && !info.latest) {
    versionText.textContent = cur + " · could not check";
    versionText.title = info.error;
  } else if (info && info.latest) {
    versionText.textContent = cur + " · up to date";
    versionText.title = "";
  } else {
    versionText.textContent = cur;
  }
}

function checkForUpdates(force) {
  renderUpdateInfo(updateInfo, true);
  fetch(apiUrl("/api/app/update" + (force ? "?force=1" : "")), { cache: "no-store" })
    .then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    })
    .then(function (info) {
      renderUpdateInfo(info, false);
      // The launcher reopened while a download runs: keep its progress moving.
      if (info.download && info.download.state === "downloading") pollDownload();
    })
    .catch(function (e) {
      var prev = updateInfo || {};
      renderUpdateInfo(
        { current: prev.current, latest: prev.latest, newer: prev.newer, pageUrl: prev.pageUrl, error: String(e && e.message ? e.message : e) },
        false,
      );
    });
}

function pollDownload() {
  if (updatePoll) return;
  updatePoll = setInterval(function () {
    fetch(apiUrl("/api/app/update"), { cache: "no-store" })
      .then(function (r) {
        return r.json();
      })
      .then(function (info) {
        renderUpdateInfo(info, false);
        if (!(info.download && info.download.state === "downloading")) {
          clearInterval(updatePoll);
          updatePoll = null;
          if (info.download && info.download.state === "ready" && installWhenReady) installNow();
          else installWhenReady = false;
        }
      })
      .catch(function () {});
  }, 1000);
}

function installNow() {
  renderUpdateInfo(updateInfo, false);
  window.edexoElectron.installUpdate().then(function (r) {
    if (r && r.ok) {
      // Still here after a while: the quit was called off ("Keep the app open" while a backup
      // was written). Back to the button.
      setTimeout(function () {
        installWhenReady = false;
        checkForUpdates(false);
      }, 15000);
      return;
    }
    installWhenReady = false;
    renderUpdateInfo(updateInfo, false);
    versionText.textContent = (r && r.error) || "Could not start the update.";
  });
}

function openUpdatePage() {
  fetch(apiUrl("/api/app/open-update"), { method: "POST" })
    .then(function (r) {
      return r.json();
    })
    .then(function (j) {
      if (!j.ok) throw new Error(j.error || "Could not open the page");
    })
    .catch(function () {
      // No browser could be started from here (or the route is missing): open the page in a
      // window of this app instead, so the link still goes somewhere.
      if (updateInfo && updateInfo.pageUrl) window.open(updateInfo.pageUrl, "_blank", "noopener");
    });
}

/** What ran when the page loaded, in the order it ran (main.js calls each module's in the file's old order). */
export function start() {

  btnUpdatePage.addEventListener("click", function () {
    openUpdatePage();
  });

  btnCheckUpdate.addEventListener("click", function () {
    if (!(updateInfo && updateInfo.newer)) {
      checkForUpdates(true);
      return;
    }
    if (canSelfUpdate(updateInfo)) {
      installWhenReady = true;
      // Downloaded and checked already (an earlier press that was called off): install now.
      if (updateInfo.download.state === "ready") {
        installNow();
        return;
      }
      fetch(apiUrl("/api/app/update/download"), { method: "POST" })
        .then(function (r) {
          return r.json();
        })
        .then(function (dl) {
          renderUpdateInfo(Object.assign({}, updateInfo, { download: dl }), false);
          pollDownload();
        })
        .catch(function (e) {
          versionText.textContent = "Could not start the download: " + String(e && e.message ? e.message : e);
        });
      return;
    }
    openUpdatePage();
  });

  checkForUpdates(false);
}
