/*
  The status card: the live link to the server (the launcher's WebSocket slice), the /api/status poll, and the lamp, title and boot progress drawn from either.
  Split out of public/launcher.js (discuss item 19, 1.3.1).
*/
import { apiUrl, renderConnectUrls } from "./network.js";
import { renderPollRates, renderRadarRadius } from "./options.js";
import { renderJournalHealth, renderLiveStrip } from "./liveStrip.js";
import { maybeShowWizard } from "./wizard.js";
import { renderCommanders } from "./commanders.js";

const lamp = document.getElementById("statusLamp");
const statusTitle = document.getElementById("statusTitle");
const statusDetail = document.getElementById("statusDetail");
export const modalLocalUrlList = document.getElementById("modalLocalUrlList");
export const modalLanUrlList = document.getElementById("modalLanUrlList");
export const modalPublicUrlList = document.getElementById("modalPublicUrlList");
export const networkSettingsModal = document.getElementById("networkSettingsModal");
export const networkSettingsClose = document.getElementById("networkSettingsClose");
export const networkSettingsMsg = document.getElementById("networkSettingsMsg");
export const btnNetworkSettings = document.getElementById("btnNetworkSettings");
export const toggleSectionLocal = document.getElementById("toggleSectionLocal");
export const toggleSectionLan = document.getElementById("toggleSectionLan");
export const toggleSectionPublic = document.getElementById("toggleSectionPublic");
export const eyeLan = document.getElementById("eyeLan");
export const eyePublic = document.getElementById("eyePublic");
export const forgetPublic = document.getElementById("forgetPublic");
export const btnExomasteryRefresh = document.getElementById("btnExomasteryRefresh");
export const btnOverlayMenu = document.getElementById("btnOverlayMenu");
export const overlayPickModal = document.getElementById("overlayPickModal");
export const overlayPickClose = document.getElementById("overlayPickClose");
export const ovExoDistance = document.getElementById("ovExoDistance");
export const ovFssScan = document.getElementById("ovFssScan");
export const ovExoCandidates = document.getElementById("ovExoCandidates");
export const ovDataValue = document.getElementById("ovDataValue");
export const launcherActionMsg = document.getElementById("launcherActionMsg");
export const btnMainUi = document.getElementById("btnMainUi");
export const btnMainUiMenu = document.getElementById("btnMainUiMenu");
export const mainUiMenu = document.getElementById("mainUiMenu");
export const mainUiSplit = document.getElementById("mainUiSplit");
export const btnMainUiSub = document.getElementById("btnMainUiSub");
export const btnColonize = document.getElementById("btnColonize");
export const btnColonizeSub = document.getElementById("btnColonizeSub");
export const btnOptions = document.getElementById("btnOptions");
export const modal = document.getElementById("modal");
export const journalInput = document.getElementById("journalInput");
export const modalCancel = document.getElementById("modalCancel");
export const modalSave = document.getElementById("modalSave");
export const optErr = document.getElementById("optErr");
export const pollSection = document.getElementById("pollSection");
export const pollStatusMs = document.getElementById("pollStatusMs");
export const pollJournalMs = document.getElementById("pollJournalMs");
export const pollApplied = document.getElementById("pollApplied");
export const pollDefaults = document.getElementById("pollDefaults");
export const hudPollSummary = document.getElementById("hudPollSummary");
export const btnPollFromOverlay = document.getElementById("btnPollFromOverlay");
export const radarRadiusRow = document.getElementById("radarRadiusRow");
export const radarRadiusM = document.getElementById("radarRadiusM");
const statusBoot = document.getElementById("statusBoot");
const statusBootFill = document.getElementById("statusBootFill");

let ws;
let wsOk = false;
let pollDelayMs = 2500;
var wsReconnectTimer = null;

export function connectWs() {
  if (wsReconnectTimer) {
    clearTimeout(wsReconnectTimer);
    wsReconnectTimer = null;
  }
  try {
    if (ws) {
      ws.onopen = ws.onclose = ws.onerror = ws.onmessage = null;
      try {
        ws.close();
      } catch (e) {}
    }
  } catch (e) {}
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  try {
    // The channel in the address: the first frame is already the launcher's slice (plan O-H).
    ws = new WebSocket(proto + "//" + location.host + "/ws?channel=launcher");
    ws.onopen = function () {
      wsOk = true;
      /* The launcher's slice only: lamp, folder, boot progress. The strip polls /api/status. */
      try { ws.send(JSON.stringify({ type: "hello", channel: "launcher" })); } catch (e) {}
    };
    /*
      Every state push is the full snapshot (hundreds of KB, up to once a second while the
      game writes Status.json). The launcher only needs the lamp, the folder and the live
      strip, so a big frame is parsed at most every 3 s; small frames (boot progress) always.
    */
    var lastWsApply = 0;
    ws.onmessage = function (ev) {
      var now = Date.now();
      var big = typeof ev.data === "string" && ev.data.length > 60000;
      if (big && now - lastWsApply < 3000) return;
      try {
        var msg = JSON.parse(ev.data);
        if (msg && msg.type === "state" && msg.payload) {
          lastWsApply = now;
          applyLauncherSnapshotData(msg.payload);
        }
      } catch (e) {}
    };
    ws.onclose = function () {
      wsOk = false;
      wsReconnectTimer = setTimeout(connectWs, 1300);
    };
    ws.onerror = function () {
      wsOk = false;
    };
  } catch (e) {
    wsOk = false;
    wsReconnectTimer = setTimeout(connectWs, 2000);
  }
}

function applyLauncherSnapshotData(data) {
  // The journal boot's progress stays inside the status card; the panel never leaves (2026-10-19).
  if (data.journalBoot) {
    const b = data.journalBoot;
    const p = Math.max(0, Math.min(100, Number(b.percent) || 0));
    lamp.className = "lamp busy";
    statusTitle.textContent = typeof b.message === "string" ? b.message : "Loading your journals…";
    statusDetail.textContent = p + "%";
    if (statusBoot && statusBootFill) {
      statusBoot.hidden = false;
      statusBootFill.style.width = p + "%";
    }
    pollDelayMs = 400;
    return;
  }

  pollDelayMs = 2500;
  if (statusBoot) statusBoot.hidden = true;

  // The feeder's Spansh dump import: Options → Developer tools in the app (off by default since 1.2.20).
  const importDump = document.getElementById("btnImportDump");
  if (importDump && "feederEnabled" in data) importDump.hidden = data.feederEnabled !== true;

  const dirOk = data.journalDirConfiguredOk === true;
  const hasJournal = data.journalFileCount > 0;
  const good = dirOk && wsOk;

  lamp.className = "lamp " + (good ? "ok" : "bad");
  if (!dirOk) {
    statusTitle.textContent = "Journal folder missing or unreadable";
    statusDetail.textContent = data.journalDir || "";
  } else if (!wsOk) {
    statusTitle.textContent = "Server up — live link not active";
    statusDetail.textContent = "WebSocket not connected; try refresh.";
  } else if (!hasJournal) {
    statusTitle.textContent = "All systems nominal — waiting for journal logs";
    statusDetail.textContent = (data.journalDir || "") + " — 0 files merged (launch Elite or check path).";
    lamp.className = "lamp ok";
  } else {
    statusTitle.textContent = "All systems nominal";
    statusDetail.textContent =
      (data.journalFileCount || 0) + " journal file(s) · " + (data.lastJournalEventIso || "no events yet");
  }

  renderConnectUrls(data);
  // Only while the modal is shut. The poll runs every 2.5 s, so writing these fields
  // unconditionally rewrote the folder path out from under whoever was typing it.
  if (!modal.classList.contains("on")) {
    journalInput.value = data.journalDir || "";
    renderPollRates(data.pollRates);
    renderRadarRadius(data.radarRadius);
  }
  renderLiveStrip(data);
  renderJournalHealth(data);
  renderCommanders(data);
  maybeShowWizard(data);
}

export async function poll() {
  try {
    // /api/status is the launcher-sized payload: no snapshot rebuild (~186 ms, ~630 KB)
    // every 2.5 s just to render the lamp and the journal folder.
    const r = await fetch(apiUrl("/api/status"), { cache: "no-store" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const data = await r.json();
    applyLauncherSnapshotData(data);
  } catch (e) {
    pollDelayMs = 2500;
    if (statusBoot) statusBoot.hidden = true;
    lamp.className = "lamp bad";
    statusTitle.textContent = "Cannot reach the EDEXO service";
    statusDetail.textContent = String(e && e.message ? e.message : e);
    if (modalLocalUrlList) modalLocalUrlList.innerHTML = "";
    if (modalLanUrlList) modalLanUrlList.innerHTML = "";
    if (modalPublicUrlList) modalPublicUrlList.innerHTML = "";
  }
}

export function loopPoll() {
  void poll().then(function () {
    setTimeout(loopPoll, pollDelayMs);
  });
}
