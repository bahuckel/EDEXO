/**
 * The only place a scrape reaches disk.
 *
 * It used to be written by the content script through a `FileSystemDirectoryHandle` kept in
 * IndexedDB. A content script runs in an isolated world but shares its *origin's* storage with
 * the page, so that handle sat in inara.cz's own IndexedDB: any script on inara.cz — the site,
 * an ad, an injected one — could open the same database, take the handle and write whatever it
 * liked into the folder the app watches and auto-imports. The app parses those files without a
 * commander ever seeing them.
 *
 * So there is no handle any more. The service worker writes through `chrome.downloads`, which
 * cannot escape the browser's download directory, and the content script cannot reach that API
 * at all. The payload it sends is data: the filename is rebuilt here, never taken from the page.
 */
const DOWNLOAD_SUBDIR = "EdexoColonize/inara";
const MAX_STATIONS = 5000;
/** A 120-row scrape is ~40 KB; this is a ceiling, not a target. */
const MAX_JSON_BYTES = 4 * 1024 * 1024;

function slug(s) {
  return (
    String(s ?? "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "commodity"
  );
}

/** Accept only the shape the app's importer understands, and rebuild it field by field. */
function cleanPayload(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (raw.source !== "inara") return null;
  const commodityLabel = String(raw.commodityLabel ?? "").trim();
  const nearSystem = String(raw.nearSystem ?? "").trim();
  if (!commodityLabel || !nearSystem) return null;
  if (!Array.isArray(raw.stations) || !raw.stations.length) return null;
  if (raw.stations.length > MAX_STATIONS) return null;
  return {
    version: 1,
    source: "inara",
    addonVersion: chrome.runtime.getManifest().version,
    scrapedAt: new Date().toISOString(),
    nearSystem,
    commodityLabel,
    stations: raw.stations,
  };
}

/** `URL.createObjectURL` does not exist in a service worker; a data: URL is the way in. */
function jsonDataUrl(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return `data:application/json;base64,${btoa(binary)}`;
}

async function saveScrape(payload) {
  const doc = cleanPayload(payload);
  if (!doc) return { ok: false, err: "That does not look like an Inara buy-search result." };

  const text = JSON.stringify(doc, null, 2);
  if (text.length > MAX_JSON_BYTES) return { ok: false, err: "Scrape is too large to save." };

  const stamp = doc.scrapedAt.replace(/[:.]/g, "").slice(0, 15);
  const fileName = `${slug(doc.commodityLabel)}__${slug(doc.nearSystem)}__${stamp}.json`;

  await chrome.downloads.download({
    url: jsonDataUrl(text),
    filename: `${DOWNLOAD_SUBDIR}/${fileName}`,
    conflictAction: "uniquify",
    saveAs: false,
  });

  try {
    await chrome.storage.local.set({
      edexoLastScrape: {
        at: doc.scrapedAt,
        file: fileName,
        count: doc.stations.length,
        commodity: doc.commodityLabel,
        near: doc.nearSystem,
      },
    });
  } catch {
    /* the file is already on disk; the popup line is cosmetic */
  }
  return { ok: true, fileName, folder: DOWNLOAD_SUBDIR };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type !== "edexo-save-scrape") return;
  /** Only our own content script, and only from the site it is declared for. */
  if (sender.id !== chrome.runtime.id) return;
  if (!/^https:\/\/inara\.cz\//.test(sender.url || "")) {
    sendResponse({ ok: false, err: "Scrapes are only accepted from inara.cz." });
    return true;
  }
  saveScrape(msg.payload)
    .then(sendResponse)
    .catch((e) => sendResponse({ ok: false, err: e?.message ? e.message : String(e) }));
  return true;
});
