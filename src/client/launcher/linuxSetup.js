/*
  Linux setup: what this desktop needs for the tray and the HUD, checked and explained.
  Split out of public/launcher.js (discuss item 19, 1.3.1).
*/
import { apiUrl } from "./network.js";

/* ------------------------------------------------------------------ Linux setup */
/*
  The Linux start-up check (server: linuxCheck.ts). Only failures come back, each with the install
  command for this distro. Shown once per set of problems: closing it remembers that set, and a
  new problem shows it again. Ctrl+Alt+H being taken is Electron's to know, so it is added here.
*/
var LS_LINUX_SEEN = "edexo.launcher.linuxSetupSeen";
export var linuxSetupModal = document.getElementById("linuxSetupModal");
var linuxSetupList = document.getElementById("linuxSetupList");
var linuxSetupIntro = document.getElementById("linuxSetupIntro");
var linuxSetupSig = "";
// The first-run card goes first (the journal folder matters most); this one waits for it.
export var linuxSetupPending = false;
/** The first-run card puts the Linux setup card aside while it is up, and back when it closes (wizard.js). */
export function setLinuxSetupPending(on) {
  linuxSetupPending = on;
}
export function wizardIsOpen() {
  var wz = document.getElementById("wizardModal");
  return !!(wz && wz.classList.contains("on"));
}
function linuxSetupItemEl(it) {
  var li = document.createElement("li");
  li.className = it.severity || "warning";
  var t = document.createElement("strong");
  t.textContent = it.title;
  var d = document.createElement("div");
  d.textContent = it.detail;
  li.appendChild(t);
  li.appendChild(d);
  if (it.command) {
    var row = document.createElement("div");
    row.className = "linux-setup-cmd";
    var code = document.createElement("code");
    code.textContent = it.command;
    var copy = document.createElement("button");
    copy.type = "button";
    copy.className = "btn-mini";
    copy.textContent = "Copy";
    copy.addEventListener("click", function () {
      try {
        void navigator.clipboard.writeText(it.command).then(function () { copy.textContent = "Copied"; });
      } catch (e) {}
    });
    row.appendChild(code);
    row.appendChild(copy);
    li.appendChild(row);
  } else if (it.packages && it.packages.length) {
    var p = document.createElement("div");
    p.className = "hint";
    p.textContent = "Install with your package manager: " + it.packages.join(", ");
    li.appendChild(p);
  }
  if (it.then) {
    var th = document.createElement("div");
    th.className = "hint";
    th.textContent = "Then: " + it.then.replace(/`/g, "");
    li.appendChild(th);
  }
  return li;
}
export async function loadLinuxSetup(force) {
  var r;
  try {
    r = await (await fetch(apiUrl("/api/system/linux-check"), { cache: "no-store" })).json();
  } catch (e) {
    return;
  }
  if (!r || !r.applicable) return;
  var items = (r.items || []).slice();
  var ee = window.edexoElectron;
  if (ee && typeof ee.getHotkeyStatus === "function") {
    try {
      var hk = await ee.getHotkeyStatus();
      if (hk && hk.registered === false) {
        items.push({
          id: "hotkey",
          severity: "warning",
          title: hk.shortcut + " is taken",
          detail:
            "Your desktop (or another app) already uses " + hk.shortcut + ", so it cannot show and hide the HUDs. " +
            "Free it in your desktop's keyboard shortcuts and restart, or use Show / Hide in the Overlays menu.",
        });
      }
    } catch (e) {}
  }
  var sig = items.map(function (i) { return i.id; }).sort().join(",");
  if (!items.length) { if (linuxSetupModal) linuxSetupModal.classList.remove("on"); return; }
  if (!force) {
    var seen = null;
    try { seen = localStorage.getItem(LS_LINUX_SEEN); } catch (e) {}
    if (seen === sig) return;
  }
  linuxSetupSig = sig;
  if (linuxSetupIntro) {
    linuxSetupIntro.textContent =
      (r.distro && r.distro.name ? r.distro.name : "Linux") +
      (r.session ? " · " + r.session : "") +
      (r.desktop ? " · " + r.desktop : "") +
      " — " + items.length + (items.length === 1 ? " thing" : " things") + " to sort out:";
  }
  if (linuxSetupList) {
    linuxSetupList.innerHTML = "";
    items.forEach(function (it) { linuxSetupList.appendChild(linuxSetupItemEl(it)); });
  }
  if (wizardIsOpen()) {
    linuxSetupPending = true;
    return;
  }
  if (linuxSetupModal) linuxSetupModal.classList.add("on");
}
function closeLinuxSetup() {
  try { localStorage.setItem(LS_LINUX_SEEN, linuxSetupSig); } catch (e) {}
  if (linuxSetupModal) linuxSetupModal.classList.remove("on");
}
var linuxSetupClose = document.getElementById("linuxSetupClose");
var linuxSetupRecheck = document.getElementById("linuxSetupRecheck");

/** What ran when the page loaded, in the order it ran (main.js calls each module's in the file's old order). */
export function start() {
  if (linuxSetupClose) linuxSetupClose.addEventListener("click", closeLinuxSetup);
  if (linuxSetupRecheck) linuxSetupRecheck.addEventListener("click", function () { void loadLinuxSetup(true); });
  void loadLinuxSetup(false);
}
