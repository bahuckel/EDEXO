/*
  The Network panel: the addresses this PC, the LAN and the internet reach the app by, which of them are shown, the LAN access switch and its warning.
  Split out of public/launcher.js (discuss item 19, 1.3.1).
*/
import { btnNetworkSettings, eyeLan, eyePublic, forgetPublic, modalLanUrlList, modalLocalUrlList, modalPublicUrlList, networkSettingsClose, networkSettingsModal, networkSettingsMsg, toggleSectionLan, toggleSectionLocal, toggleSectionPublic } from "./status.js";
import { wizardIsOpen } from "./linuxSetup.js";
import { fillWizardQuestions, wzLanStep } from "./wizard.js";

var LS_URL_ON = "edexo.launcher.urlOn";
var LS_PUBLIC_URL = "edexo.launcher.publicUrl";
var LS_SEC_LOCAL = "edexo.launcher.sec.local";
var LS_SEC_LAN = "edexo.launcher.sec.lan";
var LS_SEC_PUBLIC = "edexo.launcher.sec.public";
var LS_REVEAL_LAN = "edexo.launcher.reveal.lan";
var LS_REVEAL_PUBLIC = "edexo.launcher.reveal.public";
/* Where "Open Compare" (and "Open Colonize") opens. Defaults to the browser, per the owner. */
export var LS_OPEN_MODE = "edexo.launcher.openMode";
export var lastPort = 7111;
var lastConnectData = null;

export function readBoolLs(key, defVal) {
  try {
    var v = localStorage.getItem(key);
    if (v === null) return defVal;
    return v !== "0" && v !== "false";
  } catch (e) {
    return defVal;
  }
}

export function writeBoolLs(key, val) {
  try {
    localStorage.setItem(key, val ? "1" : "0");
  } catch (e) {}
}

function getSectionLocal() {
  return readBoolLs(LS_SEC_LOCAL, true);
}
function getSectionLan() {
  return readBoolLs(LS_SEC_LAN, true);
}
function getSectionPublic() {
  return readBoolLs(LS_SEC_PUBLIC, true);
}
function getRevealLan() {
  return readBoolLs(LS_REVEAL_LAN, true);
}
function getRevealPublic() {
  return readBoolLs(LS_REVEAL_PUBLIC, false);
}

function getStoredPublicUrl() {
  try {
    return localStorage.getItem(LS_PUBLIC_URL) || "";
  } catch (e) {
    return "";
  }
}

/**
 * Delete the stored WAN address.
 *
 * The eye only controls whether it is drawn; the value itself persisted forever, so anyone
 * screenshotting the launcher with the eye open published their home IP and had no way to
 * take it back. Hiding is also turned off, so the next render does not immediately look the
 * address up again — forgetting has to mean forgetting until asked.
 */
function forgetPublicUrl() {
  try {
    localStorage.removeItem(LS_PUBLIC_URL);
  } catch (e) {}
  writeBoolLs(LS_REVEAL_PUBLIC, false);
}

function syncNetworkModalControls() {
  if (toggleSectionLocal) toggleSectionLocal.checked = getSectionLocal();
  if (toggleSectionLan) toggleSectionLan.checked = getSectionLan();
  if (toggleSectionPublic) toggleSectionPublic.checked = getSectionPublic();
  var rl = getRevealLan();
  var rp = getRevealPublic();
  if (eyeLan) {
    var lanOn = getSectionLan();
    eyeLan.disabled = !lanOn;
    eyeLan.setAttribute("aria-pressed", rl ? "true" : "false");
    eyeLan.classList.toggle("net-eye--off", !rl);
  }
  if (eyePublic) {
    var pubOn = getSectionPublic();
    eyePublic.disabled = !pubOn;
    eyePublic.setAttribute("aria-pressed", rp ? "true" : "false");
    eyePublic.classList.toggle("net-eye--off", !rp);
  }
  if (forgetPublic) {
    // Nothing stored, nothing to forget — and a live button that does nothing would leave
    // the user unsure whether it had worked.
    forgetPublic.disabled = !getStoredPublicUrl();
  }
}

function makePlaceholderRow(text) {
  var li = document.createElement("li");
  li.className = "net-placeholder dim";
  li.textContent = text;
  return li;
}

function publicUrlMatchesPort(savedPub, port) {
  if (!savedPub) return false;
  try {
    return Number(new URL(savedPub).port || 0) === port || savedPub.indexOf(":" + port + "/") >= 0;
  } catch (e2) {
    return false;
  }
}

function clearNetworkMsg() {
  if (networkSettingsMsg) {
    networkSettingsMsg.className = "msg-launcher";
    networkSettingsMsg.textContent = "";
  }
}

function fetchPublicIpAndSave() {
  return fetch("https://api.ipify.org?format=json", { cache: "no-store" })
    .then(function (r) {
      return r.json();
    })
    .then(function (j) {
      var ip = j && j.ip;
      if (!ip) throw new Error("No IP in response");
      var u = "http://" + ip + ":" + lastPort + "/";
      localStorage.setItem(LS_PUBLIC_URL, u);
      return u;
    });
}

export function apiUrl(pathname) {
  var proto = window.location.protocol || "";
  if (proto === "http:" || proto === "https:") return pathname;
  return "http://127.0.0.1:" + (lastPort || 7111) + pathname;
}

function readUrlOn() {
  try {
    var j = JSON.parse(localStorage.getItem(LS_URL_ON) || "{}");
    return j && typeof j === "object" ? j : {};
  } catch (e) {
    return {};
  }
}
function writeUrlOn(map) {
  localStorage.setItem(LS_URL_ON, JSON.stringify(map));
}
function isUrlEnabled(url) {
  return readUrlOn()[url] !== false;
}
function setUrlEnabled(url, on) {
  var m = readUrlOn();
  m[url] = on;
  writeUrlOn(m);
}

function makeUrlRow(url, tag) {
  var on = isUrlEnabled(url);
  var li = document.createElement("li");
  li.className = "url-row" + (on ? "" : " url-row--off");
  var btn = document.createElement("button");
  btn.type = "button";
  btn.className = "url-toggle";
  btn.setAttribute("aria-pressed", on ? "true" : "false");
  btn.setAttribute("aria-label", "Enable or dim this address");
  btn.textContent = on ? "●" : "○";
  var inner = document.createElement("div");
  inner.className = "url-row-inner";
  var a = document.createElement("a");
  a.href = url;
  a.target = "_blank";
  a.rel = "noopener";
  a.textContent = tag ? tag + " · " + url : url;
  inner.appendChild(a);
  li.appendChild(btn);
  li.appendChild(inner);
  btn.addEventListener("click", function (e) {
    e.preventDefault();
    var next = !isUrlEnabled(url);
    setUrlEnabled(url, next);
    li.classList.toggle("url-row--off", !next);
    btn.setAttribute("aria-pressed", next ? "true" : "false");
    btn.textContent = next ? "●" : "○";
  });
  return li;
}

var lanWarning = document.getElementById("lanWarning");

function renderLanWarning(data) {
  if (!lanWarning) return;
  if (!data || data.mode !== "server") {
    lanWarning.hidden = true;
    return;
  }
  lanWarning.hidden = false;
  lanWarning.innerHTML = data.lanKeyRequired
    ? "<strong>Anyone on this network</strong> who has the link below can read your journal data and " +
      "change settings, including resetting exobiology progress. The link carries a one-time " +
      "<strong>access key</strong>: open it once on each device and that device stays paired. " +
      "Treat it like a password — this PC never needs it."
    : "<strong>Anyone on this network</strong> can reach this app with no access key. " +
      "Start it with <strong>--local</strong> to bind to this PC only.";
}

var lanAccessBox = document.getElementById("lanAccessBox");
export var lanAccessToggle = document.getElementById("lanAccessToggle");
var lanAccessNote = document.getElementById("lanAccessNote");
var lanAccessRestart = document.getElementById("lanAccessRestart");
var lanAccessBusy = false;

function renderLanAccess(data) {
  if (!lanAccessBox) return;
  var la = data && data.lanAccess;
  lanAccessBox.hidden = !la;
  if (!la) return;
  if (!lanAccessBusy) lanAccessToggle.checked = !!la.saved;
  var pending = !!la.saved !== !!la.active;
  var canRestart = !!(window.edexoElectron && typeof window.edexoElectron.relaunch === "function");
  lanAccessNote.textContent = pending
    ? (la.saved ? "On after a restart." : "Off after a restart.") +
      (canRestart ? "" : " Close the app and start it again.")
    : la.active
      ? "On: devices on this network can open the app with the links below (they carry the access key)."
      : "Off: only this PC can open the app.";
  lanAccessRestart.hidden = !(pending && canRestart);
  // The first-run card opened before the status said whether there is a switch: ask now.
  if (wzLanStep && wzLanStep.hidden && wizardIsOpen()) fillWizardQuestions(data);
}

/* The Network panel's switch and the first-run question both save through here. */
export function saveLanAccess(enabled) {
  lanAccessBusy = true;
  return fetch(apiUrl("/api/launcher/lan-access"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled: enabled }),
  })
    .then(function (r) {
      return r.json();
    })
    .then(function (j) {
      lanAccessBusy = false;
      if (j && j.ok && lastConnectData) {
        lastConnectData.lanAccess = j.lanAccess;
        renderConnectUrls(lastConnectData);
      }
      return j;
    })
    .catch(function () {
      lanAccessBusy = false;
      return null;
    });
}

export function renderConnectUrls(data) {
  // The WebSocket frames carry no lanAccess, only /api/status does: keep the last one known.
  if (data && data.lanAccess === undefined && lastConnectData && lastConnectData.lanAccess !== undefined) {
    data.lanAccess = lastConnectData.lanAccess;
  }
  lastConnectData = data;
  lastPort = typeof data.port === "number" && data.port > 0 ? data.port : 7111;
  var localUrl = "http://127.0.0.1:" + lastPort + "/";
  if (!modalLocalUrlList || !modalLanUrlList || !modalPublicUrlList) return;

  modalLocalUrlList.innerHTML = "";
  if (getSectionLocal()) {
    modalLocalUrlList.appendChild(makeUrlRow(localUrl, "This PC"));
  } else {
    modalLocalUrlList.appendChild(
      makePlaceholderRow("This computer is turned off — check “This computer” above to show localhost links."),
    );
  }

  renderLanWarning(data);
  renderLanAccess(data);

  modalLanUrlList.innerHTML = "";
  if (!getSectionLan()) {
    modalLanUrlList.appendChild(
      makePlaceholderRow("LAN is turned off — check “LAN” above to show Wi‑Fi / network links."),
    );
  } else if (!getRevealLan()) {
    modalLanUrlList.appendChild(
      makePlaceholderRow("LAN addresses are hidden — click the eye icon to show them."),
    );
  } else if (!data.lanUrls || !data.lanUrls.length) {
    var note = document.createElement("li");
    note.style.cssText =
      "margin:8px 0;padding:10px 12px;background:rgba(255,255,255,0.04);border-left:3px solid #444;font-size:0.88rem;opacity:0.72;list-style:none";
    note.textContent =
      data.lanAccess && !data.lanAccess.active
        ? data.lanAccess.saved
          ? "LAN access turns on at the next start; the links for your other devices appear here then."
          : "LAN access is off — only this PC can open the app. Turn it on above to get links for your other devices."
        : data.mode === "client"
          ? "Client build — only this PC; install the server / portable build for Wi‑Fi links."
          : "No separate LAN IPv4 found (VPN off? single interface). This PC link still works.";
    modalLanUrlList.appendChild(note);
  } else {
    data.lanUrls.forEach(function (u) {
      modalLanUrlList.appendChild(makeUrlRow(u, "LAN"));
      /* The same address as the HUD for a phone: sections, theme and order as on the PC. */
      try {
        var pu = new URL(u);
        pu.pathname = "/hud-overlay.html";
        pu.searchParams.set("phone", "1");
        modalLanUrlList.appendChild(makeUrlRow(pu.toString(), "PHONE HUD"));
        /* Colonize on a phone (1.3.0): read-only there, the PC's sites and haul plan. */
        var cu = new URL(u);
        cu.searchParams.set("screen", "colonize");
        modalLanUrlList.appendChild(makeUrlRow(cu.toString(), "PHONE COLONIZE"));
      } catch (e) {}
    });
  }

  modalPublicUrlList.innerHTML = "";
  if (!getSectionPublic()) {
    modalPublicUrlList.appendChild(
      makePlaceholderRow("Public internet is turned off — check “Public internet” above to configure WAN links."),
    );
  } else if (!getRevealPublic()) {
    modalPublicUrlList.appendChild(
      makePlaceholderRow("Public (WAN) address is hidden — click the eye icon to show or fetch it."),
    );
  } else {
    var savedPub2 = getStoredPublicUrl();
    if (savedPub2 && publicUrlMatchesPort(savedPub2, lastPort)) {
      modalPublicUrlList.appendChild(makeUrlRow(savedPub2, "Public"));
    } else if (savedPub2) {
      modalPublicUrlList.appendChild(
        makePlaceholderRow(
          "Stored public URL is for a different port than this server — use the eye to hide, then show again to refresh.",
        ),
      );
    } else {
      modalPublicUrlList.appendChild(
        makePlaceholderRow("Click the eye icon to fetch and show your public (WAN) address."),
      );
    }
  }

  syncNetworkModalControls();
}

function openNetworkSettingsModal() {
  if (!networkSettingsModal) return;
  clearNetworkMsg();
  networkSettingsModal.classList.add("on");
  syncNetworkModalControls();
  if (lastConnectData) renderConnectUrls(lastConnectData);
}

function closeNetworkSettingsModal() {
  if (networkSettingsModal) networkSettingsModal.classList.remove("on");
}

/** What ran when the page loaded, in the order it ran (main.js calls each module's in the file's old order). */
export function start() {
  if (lanAccessToggle) {
    lanAccessToggle.addEventListener("change", function () {
      void saveLanAccess(lanAccessToggle.checked);
    });
  }
  if (lanAccessRestart) {
    lanAccessRestart.addEventListener("click", function () {
      var bridge = window.edexoElectron;
      if (bridge && typeof bridge.relaunch === "function") bridge.relaunch();
    });
  }

  if (btnNetworkSettings && networkSettingsModal) {
    btnNetworkSettings.addEventListener("click", function () {
      openNetworkSettingsModal();
    });
  }
  if (networkSettingsClose && networkSettingsModal) {
    networkSettingsClose.addEventListener("click", closeNetworkSettingsModal);
  }
  if (networkSettingsModal) {
    networkSettingsModal.addEventListener("click", function (e) {
      if (e.target === networkSettingsModal) closeNetworkSettingsModal();
    });
  }

  if (toggleSectionLocal) {
    toggleSectionLocal.addEventListener("change", function () {
      writeBoolLs(LS_SEC_LOCAL, toggleSectionLocal.checked);
      if (lastConnectData) renderConnectUrls(lastConnectData);
    });
  }
  if (toggleSectionLan) {
    toggleSectionLan.addEventListener("change", function () {
      writeBoolLs(LS_SEC_LAN, toggleSectionLan.checked);
      if (lastConnectData) renderConnectUrls(lastConnectData);
    });
  }
  if (toggleSectionPublic) {
    toggleSectionPublic.addEventListener("change", function () {
      writeBoolLs(LS_SEC_PUBLIC, toggleSectionPublic.checked);
      if (lastConnectData) renderConnectUrls(lastConnectData);
    });
  }

  if (eyeLan) {
    eyeLan.addEventListener("click", function () {
      if (!getSectionLan()) return;
      var next = !getRevealLan();
      writeBoolLs(LS_REVEAL_LAN, next);
      clearNetworkMsg();
      if (lastConnectData) renderConnectUrls(lastConnectData);
    });
  }

  if (eyePublic) {
    eyePublic.addEventListener("click", function () {
      if (!getSectionPublic()) return;
      if (getRevealPublic()) {
        writeBoolLs(LS_REVEAL_PUBLIC, false);
        clearNetworkMsg();
        if (lastConnectData) renderConnectUrls(lastConnectData);
        return;
      }
      writeBoolLs(LS_REVEAL_PUBLIC, true);
      syncNetworkModalControls();
      clearNetworkMsg();
      var savedPub = getStoredPublicUrl();
      if (savedPub && publicUrlMatchesPort(savedPub, lastPort)) {
        if (lastConnectData) renderConnectUrls(lastConnectData);
        return;
      }
      if (lastConnectData) renderConnectUrls(lastConnectData);
      eyePublic.disabled = true;
      fetchPublicIpAndSave()
        .then(function () {
          if (lastConnectData) renderConnectUrls(lastConnectData);
        })
        .catch(function () {
          writeBoolLs(LS_REVEAL_PUBLIC, false);
          if (networkSettingsMsg) {
            networkSettingsMsg.className = "msg-launcher err";
            networkSettingsMsg.textContent =
              "Could not look up public IP (offline, firewall, or API blocked).";
          }
          syncNetworkModalControls();
          if (lastConnectData) renderConnectUrls(lastConnectData);
        })
        .finally(function () {
          if (eyePublic) eyePublic.disabled = !getSectionPublic();
          syncNetworkModalControls();
        });
    });
  }

  if (forgetPublic) {
    forgetPublic.addEventListener("click", function () {
      if (!getStoredPublicUrl()) return;
      forgetPublicUrl();
      syncNetworkModalControls();
      if (lastConnectData) renderConnectUrls(lastConnectData);
      if (networkSettingsMsg) {
        networkSettingsMsg.className = "msg-launcher ok";
        networkSettingsMsg.textContent =
          "Public address forgotten. Nothing was sent anywhere — it only ever lived on this device.";
      }
    });
  }
}
