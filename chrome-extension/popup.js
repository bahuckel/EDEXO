const statusEl = document.getElementById("status");
const folderEl = document.getElementById("folder");
const showBtn = document.getElementById("show");

/** Matches DOWNLOAD_SUBDIR in background.js. */
const DOWNLOAD_SUBDIR = "EdexoColonize/inara";

function setStatus(text) {
  if (statusEl) statusEl.textContent = text;
}

async function refreshLast() {
  const { edexoLastScrape } = await chrome.storage.local.get("edexoLastScrape");
  const last = edexoLastScrape;
  if (!last) {
    setStatus("Last scrape: none yet");
    return;
  }
  const bits = [];
  if (last.file) bits.push(last.file);
  if (typeof last.count === "number") bits.push(`${last.count} stations`);
  if (last.commodity && last.near) bits.push(`${last.commodity} near ${last.near}`);
  setStatus(`Last scrape: ${bits.join(" · ") || "saved"}`);
}

if (folderEl) folderEl.textContent = `Saves to your Downloads folder, under ${DOWNLOAD_SUBDIR}`;

/** Chrome will not say where the download directory is, so let it reveal the file instead. */
showBtn?.addEventListener("click", async () => {
  const [item] = await chrome.downloads.search({
    limit: 1,
    orderBy: ["-startTime"],
    filenameRegex: "EdexoColonize",
  });
  if (!item) {
    setStatus("Nothing scraped yet — nothing to show.");
    return;
  }
  chrome.downloads.show(item.id);
});

void refreshLast();
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.edexoLastScrape) void refreshLast();
});
