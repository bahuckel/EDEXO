/*
  Options: the journal folder, the two live-file poll rates and the sample radar's radius.
  Split out of public/launcher.js (discuss item 19, 1.3.1).
*/
import { btnOptions, btnPollFromOverlay, hudPollSummary, journalInput, modal, modalCancel, modalSave, optErr, overlayPickModal, poll, pollApplied, pollDefaults, pollJournalMs, pollSection, pollStatusMs, radarRadiusM, radarRadiusRow } from "./status.js";
import { apiUrl } from "./network.js";

/*
  The two live-file poll rates.

  Bounds come from the server (`shared/pollRates.ts`) rather than being written into the
  input attributes here, so this window can never offer a number the server would clamp.
  A build without the setting sends no `pollRates` and the section simply stays hidden.
*/
let pollBounds = null;
let pollAppliedTimer = null;

export function renderPollRates(rates) {
  if (!pollSection) return;
  if (!rates || typeof rates !== "object") {
    pollSection.hidden = true;
    return;
  }
  pollBounds = rates;
  pollSection.hidden = false;
  pollStatusMs.min = String(rates.statusMinMs);
  pollStatusMs.max = String(rates.statusMaxMs);
  pollJournalMs.min = String(rates.journalMinMs);
  pollJournalMs.max = String(rates.journalMaxMs);
  if (document.activeElement !== pollStatusMs) pollStatusMs.value = String(rates.statusPollMs);
  if (document.activeElement !== pollJournalMs) pollJournalMs.value = String(rates.journalPollMs);
  if (hudPollSummary) {
    hudPollSummary.textContent = "The HUDs follow Status.json, read every " + rates.statusPollMs + " ms";
  }
}

function flashPollApplied() {
  if (!pollApplied) return;
  pollApplied.classList.add("on");
  if (pollAppliedTimer) clearTimeout(pollAppliedTimer);
  pollAppliedTimer = setTimeout(function () {
    pollApplied.classList.remove("on");
  }, 1400);
}

/*
  Sent on `change`, not on every keystroke: `input` fires per digit, so typing "2000" would
  walk the server through 2, 20 and 200 ms — re-arming the timer three times on its way to a
  rate the commander never asked for.
*/
async function savePollRates(statusMs, journalMs) {
  if (!pollBounds) return;
  try {
    const r = await fetch(apiUrl("/api/settings/poll-rates"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ statusPollMs: statusMs, journalPollMs: journalMs }),
    });
    const j = await r.json().catch(function () {
      return {};
    });
    if (!r.ok) {
      optErr.textContent = j.error || r.statusText;
      optErr.style.display = "block";
      return;
    }
    // Show what was accepted, not what was sent — the server clamps.
    pollBounds.statusPollMs = j.statusPollMs;
    pollBounds.journalPollMs = j.journalPollMs;
    pollStatusMs.value = String(j.statusPollMs);
    pollJournalMs.value = String(j.journalPollMs);
    optErr.style.display = "none";
    flashPollApplied();
  } catch (e) {
    optErr.textContent = String(e);
    optErr.style.display = "block";
  }
}

function onPollFieldChange() {
  void savePollRates(Number(pollStatusMs.value), Number(pollJournalMs.value));
}
/*
  How far the sample radar draws.

  It lives in the Overlay panel rather than beside the poll rates, because it is a property
  of the radar and this is where the radar's other settings are. Bounds come from the server
  for the same reason as the poll rates: the input cannot then offer a value that gets
  clamped on arrival.
*/
var radarBounds = null;

export function renderRadarRadius(r) {
  if (!radarRadiusRow) return;
  if (!r || typeof r !== "object") {
    radarRadiusRow.hidden = true;
    return;
  }
  radarBounds = r;
  radarRadiusRow.hidden = false;
  radarRadiusM.min = String(r.minM);
  radarRadiusM.max = String(r.maxM);
  if (document.activeElement !== radarRadiusM) radarRadiusM.value = String(r.radiusM);
}

async function saveRadarRadius(value) {
  if (!radarBounds) return;
  try {
    var r = await fetch(apiUrl("/api/settings/radar-radius"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ radiusM: value }),
    });
    var j = await r.json().catch(function () {
      return {};
    });
    if (!r.ok) return;
    // What was accepted, not what was sent.
    radarBounds.radiusM = j.radiusM;
    radarRadiusM.value = String(j.radiusM);
  } catch (e) {
    /* the radar keeps its current circle; nothing here is worth an error banner */
  }
}

/** What ran when the page loaded, in the order it ran (main.js calls each module's in the file's old order). */
export function start() {

  btnOptions.addEventListener("click", function () {
    optErr.style.display = "none";
    modal.classList.add("on");
  });
  modalCancel.addEventListener("click", function () {
    modal.classList.remove("on");
  });
  modal.addEventListener("click", function (e) {
    if (e.target === modal) modal.classList.remove("on");
  });
  modalSave.addEventListener("click", async function () {
    optErr.style.display = "none";
    const dir = journalInput.value.trim();
    if (!dir) {
      optErr.textContent = "Enter a folder path.";
      optErr.style.display = "block";
      return;
    }
    try {
      const r = await fetch(apiUrl("/api/settings/journal-directory"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ journalDir: dir }),
      });
      const j = await r.json().catch(function () {
        return {};
      });
      if (!r.ok) {
        optErr.textContent = j.error || r.statusText;
        optErr.style.display = "block";
        return;
      }
      modal.classList.remove("on");
      await poll();
    } catch (e) {
      optErr.textContent = String(e);
      optErr.style.display = "block";
    }
  });

  if (pollStatusMs && pollJournalMs) {
    pollStatusMs.addEventListener("change", onPollFieldChange);
    pollJournalMs.addEventListener("change", onPollFieldChange);
  }

  if (radarRadiusM) {
    // `change`, not `input` — typing "1000" would otherwise walk the radar through 1, 10, 100.
    radarRadiusM.addEventListener("change", function () {
      void saveRadarRadius(Number(radarRadiusM.value));
    });
  }

  if (btnPollFromOverlay) {
    btnPollFromOverlay.addEventListener("click", function () {
      // Out of the overlay panel and into the one place the controls live. Leaving the overlay
      // modal open behind it would stack two dialogs over each other.
      if (overlayPickModal) overlayPickModal.classList.remove("on");
      btnOptions.click();
      if (pollStatusMs) pollStatusMs.focus();
    });
  }
  if (pollDefaults) {
    pollDefaults.addEventListener("click", function () {
      if (!pollBounds) return;
      void savePollRates(pollBounds.statusDefaultMs, pollBounds.journalDefaultMs);
    });
  }
}
