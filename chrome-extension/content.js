(() => {
  function numFromText(s) {
    if (!s) return null;
    const t = String(s).replace(/,/g, "").replace(/[^\d.-]/g, " ").trim();
    const m = t.match(/-?\d+(?:\.\d+)?/);
    if (!m) return null;
    const n = Number(m[0]);
    return Number.isFinite(n) ? n : null;
  }

  function cellText(td) {
    return (td?.innerText || td?.textContent || "").replace(/\s+/g, " ").trim();
  }

  function numFromTd(td) {
    if (!td) return null;
    const order = td.getAttribute("data-order");
    if (order != null && order !== "") {
      const n = Number(order);
      if (Number.isFinite(n)) return n;
    }
    return numFromText(cellText(td));
  }

  function parseLocation(td) {
    const sysEl = td?.querySelector("span.uppercase, span.nowrap");
    const systemFromSpan = (sysEl?.textContent || "").replace(/\s+/g, " ").trim();
    const parts = cellText(td)
      .split("|")
      .map((s) => s.trim())
      .filter(Boolean);
    let stationName = parts[0] || "";
    let systemName = systemFromSpan || parts[1] || "";
    if (parts.length >= 2) {
      stationName = parts[0];
      if (!systemName) systemName = parts[1];
    }
    return { stationName, systemName };
  }

  function headerIndex(headers, ...needles) {
    const n = headers.map((h) => h.toLowerCase());
    for (const needle of needles) {
      const i = n.findIndex((h) => h.includes(needle));
      if (i >= 0) return i;
    }
    return -1;
  }

  /** Keep in sync with src/shared/inaraStationIcon.ts — sprites7.png X offsets. */
  const STATION_ICON_BY_X = {
    13: { styleType: "Starport - Coriolis", isGround: false, isFleetCarrier: false },
    26: { styleType: "Space Outpost", isGround: false, isFleetCarrier: false },
    156: { styleType: "Starport - Orbis", isGround: false, isFleetCarrier: false },
    169: { styleType: "Starport - Ocellus", isGround: false, isFleetCarrier: false },
    182: { styleType: "Surface Port", isGround: true, isFleetCarrier: false },
    195: { styleType: "Surface Station", isGround: true, isFleetCarrier: false },
    247: { styleType: "Starport - Asteroid Base", isGround: false, isFleetCarrier: false },
    507: { styleType: "Carrier", isGround: false, isFleetCarrier: true },
    871: { styleType: "Starport - Dodec", isGround: false, isFleetCarrier: false },
  };

  function parseSpriteX(source) {
    const s = String(source || "");
    if (!s) return null;
    const patterns = [
      /background-position-x:\s*(-?\d+(?:\.\d+)?)px/i,
      /background-position:\s*(-?\d+(?:\.\d+)?)px/i,
      /sprites7\.png[^"'<]*?(-?\d+(?:\.\d+)?)px/i,
      /^(-?\d+(?:\.\d+)?)px\b/,
    ];
    for (const re of patterns) {
      const m = s.match(re);
      if (!m) continue;
      const x = Math.abs(Math.round(Number(m[1])));
      if (Number.isFinite(x) && x > 0) return x;
    }
    return null;
  }

  function iconFromSpriteX(x) {
    if (x == null) return { styleType: "unknown", isGround: false, isFleetCarrier: false, spriteX: null };
    const mapped = STATION_ICON_BY_X[x];
    if (!mapped) return { styleType: "unknown", isGround: false, isFleetCarrier: false, spriteX: x };
    return { ...mapped, spriteX: x };
  }

  function stationIconFromRow(td, tr) {
    const el =
      (td && td.querySelector && td.querySelector(".stationicon")) ||
      (tr && tr.querySelector && tr.querySelector(".stationicon"));
    const chunks = [];
    if (el) {
      chunks.push(el.getAttribute("style") || "");
      chunks.push(el.outerHTML || "");
      try {
        const cs = window.getComputedStyle(el);
        chunks.push(cs.backgroundPosition || "");
        chunks.push(cs.backgroundPositionX || "");
      } catch {
        /* */
      }
    }
    if (td) {
      chunks.push(td.getAttribute("style") || "");
      chunks.push(td.innerHTML || "");
    }
    if (tr) chunks.push(tr.innerHTML || "");
    for (const c of chunks) {
      const x = parseSpriteX(c);
      if (x != null) return iconFromSpriteX(x);
    }
    return iconFromSpriteX(null);
  }

  function parsePad(td) {
    const t = cellText(td);
    const ch = t ? t.charAt(0).toUpperCase() : "";
    return /[SML]/.test(ch) ? ch : null;
  }

  function resultsTable() {
    return (
      document.querySelector("#DataTables_Table_0") ||
      document.querySelector("table.dataTable") ||
      document.querySelector("table.tablesortercollapsed") ||
      document.querySelector("table.tablesorter")
    );
  }

  function scrapeTable() {
    const table = resultsTable();
    if (!table) return [];
    const headerRow = table.querySelector("thead tr") || table.querySelector("tr");
    const headers = [...(headerRow?.querySelectorAll("th, td") || [])].map((c) => cellText(c));
    const distI = headerIndex(headers, "distance");
    const supplyI = headerIndex(headers, "supply", "stock");
    const demandI = headerIndex(headers, "demand");
    const priceI = headerIndex(headers, "price");
    const padI = headerIndex(headers, "pad");
    const updatedI = headerIndex(headers, "updated", "age");
    const locI = headerIndex(headers, "location", "station");
    const stationI = locI >= 0 ? locI : 0;
    if (distI < 0 && supplyI < 0 && priceI < 0) return [];
    const rows = [...table.querySelectorAll("tbody tr, tr")].filter(
      (tr) => tr.querySelectorAll("td").length >= 2 && !tr.classList.contains("child"),
    );
    const stations = [];
    for (const tr of rows) {
      const tds = [...tr.querySelectorAll("td")];
      const { stationName, systemName } = parseLocation(tds[stationI] || tds[0]);
      if (!stationName || !systemName) continue;
      const supply = supplyI >= 0 ? numFromTd(tds[supplyI]) : null;
      const demand = demandI >= 0 ? numFromTd(tds[demandI]) : null;
      const buyPrice = priceI >= 0 ? numFromTd(tds[priceI]) : null;
      const selling = supply != null && supply > 0;
      if (!selling && demand != null && demand > 0 && (supply == null || supply <= 0)) continue;
      if (!selling && (buyPrice == null || buyPrice <= 0)) continue;
      const dist = distI >= 0 ? numFromTd(tds[distI]) : null;
      const locTd = tds[stationI] || tds[0];
      const icon = stationIconFromRow(locTd, tr);
      stations.push({
        systemName,
        stationName,
        distanceLy: dist != null && dist >= 0 ? dist : Number.POSITIVE_INFINITY,
        supply,
        buyPrice,
        styleType: icon.styleType,
        isGround: icon.isGround,
        spriteX: icon.spriteX,
        pad: padI >= 0 ? parsePad(tds[padI]) : null,
        isFleetCarrier: icon.isFleetCarrier,
        marketUpdatedAt: updatedI >= 0 ? cellText(tds[updatedI]) || null : null,
      });
    }
    return stations;
  }

  function commoditySelect() {
    return document.querySelector("#tokenizeitems, select[name='pa1[]']");
  }

  function selectedCommodityLabel() {
    const sel = commoditySelect();
    if (sel?.selectedOptions?.length) {
      const labels = [...sel.selectedOptions]
        .map((o) => (o.textContent || "").trim())
        .filter((t) => t && t !== "-" && t.toLowerCase() !== "select");
      if (labels.length) return labels[0];
    }
    const chip = document.querySelector("#tokenizeitems-ts-control .item, .ts-wrapper.multi.has-items .ts-control .item");
    if (chip) {
      const t = (chip.textContent || "").replace(/×/g, "").trim();
      if (t) return t;
    }
    const params = new URLSearchParams(location.search);
    const id = params.getAll("pa1[]")[0] || params.get("pa1[]");
    if (id && sel) {
      const opt = [...sel.options].find((o) => o.value === id);
      if (opt) return (opt.textContent || "").trim();
    }
    return (params.get("search") || "").trim();
  }

  function nearSystem() {
    const params = new URLSearchParams(location.search);
    if (params.get("ps1")?.trim()) return params.get("ps1").trim();
    const input = document.querySelector("input[name='ps1'], select[name='ps1']");
    if (input?.value?.trim()) return input.value.trim();
    const chip = document.querySelector(".ts-wrapper.single.has-items .ts-control .item[data-value]");
    if (chip?.getAttribute("data-value")?.trim()) return chip.getAttribute("data-value").trim();
    if (chip) return (chip.textContent || "").trim();
    return "";
  }

  /**
   * Hand the payload to the service worker, which is the only thing here that can write a file.
   *
   * This used to write it directly through a FileSystemDirectoryHandle persisted in IndexedDB.
   * A content script shares its origin's storage with the page, so that handle lived in
   * inara.cz's own database, and any script on inara.cz could take it and write into the folder
   * the app auto-imports. See background.js.
   */
  async function savePayload(payload) {
    let res;
    try {
      res = await chrome.runtime.sendMessage({ type: "edexo-save-scrape", payload });
    } catch (e) {
      throw new Error(
        `Extension background did not answer (${e && e.message ? e.message : e}). Reload the extension on chrome://extensions.`,
      );
    }
    if (!res?.ok) throw new Error(res?.err || "Could not save the scrape.");
    return res.fileName;
  }

  function tomSelectApi(el) {
    return el?.tomselect || el?.tomSelect || window.TomSelect?.instances?.[el?.id] || null;
  }

  function syncFormFromQuery() {
    const params = new URLSearchParams(location.search);
    if (params.get("edexo") !== "1") return false;
    const id = params.getAll("pa1[]")[0] || params.get("pa1[]");
    const sys = params.get("ps1")?.trim() || "";
    let changed = false;
    const sel = commoditySelect();
    if (sel && id) {
      const ts = tomSelectApi(sel);
      const current = sel.selectedOptions?.[0]?.value;
      if (ts) {
        if (current !== String(id)) {
          try {
            ts.clear(true);
            ts.addItem(String(id), true);
            changed = true;
          } catch {
            /* */
          }
        }
      } else {
        for (const opt of sel.options) opt.selected = opt.value === String(id);
        sel.dispatchEvent(new Event("change", { bubbles: true }));
        changed = current !== String(id);
      }
    }
    const sysInput = document.querySelector("input[name='ps1'], select[name='ps1']");
    if (sysInput && sys && sysInput.value?.trim() !== sys) {
      const ts = tomSelectApi(sysInput);
      if (ts) {
        try {
          ts.clear(true);
          ts.addItem(sys, true);
          changed = true;
        } catch {
          sysInput.value = sys;
          changed = true;
        }
      } else {
        sysInput.value = sys;
        sysInput.dispatchEvent(new Event("change", { bubbles: true }));
        changed = true;
      }
    }
    return changed;
  }

  function searchSubmit() {
    return (
      document.querySelector("form input[type='submit']") ||
      document.querySelector("form button[type='submit']") ||
      document.querySelector("input.button[type='submit']") ||
      document.querySelector("button.button[type='submit']")
    );
  }

  function maybeAutoSearch() {
    const params = new URLSearchParams(location.search);
    if (params.get("edexo") !== "1") return;
    if (resultsTable() || document.querySelector("#DataTables_Table_0_wrapper")) return;
    if (!params.getAll("pa1[]")[0] && !params.get("pa1[]")) return;
    const key = `edexo-autosearch:${location.search}`;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
    } catch {
      /* */
    }
    syncFormFromQuery();
    const btn = searchSubmit();
    if (btn && typeof btn.click === "function") btn.click();
  }

  function mountBar() {
    if (document.getElementById("edexo-inara-nav")) return null;
    const wrap = document.createElement("span");
    wrap.id = "edexo-inara-nav";
    wrap.setAttribute("role", "group");
    wrap.setAttribute("aria-label", "ED EXO Colonize");

    const brand = document.createElement("span");
    brand.className = "edexo-inara-nav__brand";
    brand.textContent = "EDEXO Colonize:";

    const scrapeBtn = document.createElement("button");
    scrapeBtn.id = "edexo-inara-save";
    scrapeBtn.type = "button";
    scrapeBtn.className = "edexo-inara-nav__btn";
    scrapeBtn.textContent = "Scrape info";
    scrapeBtn.title = "Save this buy-search table for ED EXO Colonize";

    wrap.append(brand, scrapeBtn);

    const drop = document.createElement("div");
    drop.id = "edexo-inara-drop";
    drop.hidden = true;
    document.documentElement.append(drop);

    const nav =
      document.querySelector("nav a.menulogo")?.closest("nav") ||
      document.querySelector('nav a[href="/elite"]')?.closest("nav") ||
      document.querySelector("header nav, #header nav, .header nav, nav");
    if (nav) nav.append(wrap);
    else document.body.prepend(wrap);
    return { scrapeBtn, wrap, drop };
  }

  function placePopup(el, anchor) {
    const r = anchor.getBoundingClientRect();
    el.style.top = `${Math.round(r.bottom + 5)}px`;
    el.style.right = `${Math.max(8, Math.round(window.innerWidth - r.right))}px`;
    el.style.left = "auto";
  }

  function mount() {
    const bar = mountBar();
    if (!bar) return;
    const { scrapeBtn, wrap, drop } = bar;

    scrapeBtn.addEventListener("click", async () => {
      drop.hidden = false;
      drop.textContent = "Saving…";
      placePopup(drop, wrap);
      try {
        const stations = scrapeTable();
        if (!stations.length) {
          drop.textContent = "No results table yet — run Search first.";
          return;
        }
        const commodity = selectedCommodityLabel();
        const near = nearSystem();
        if (!commodity || !near) {
          drop.textContent = "Missing commodity or near system on this page.";
          return;
        }
        const payload = {
          version: 1,
          source: "inara",
          addonVersion: chrome.runtime.getManifest().version,
          scrapedAt: new Date().toISOString(),
          nearSystem: near,
          commodityLabel: commodity,
          stations,
        };
        const name = await savePayload(payload);
        drop.textContent = `Saved to ${name}`;
        placePopup(drop, wrap);
      } catch (e) {
        drop.textContent = e && e.message ? e.message : String(e);
        placePopup(drop, wrap);
      }
    });

    syncFormFromQuery();
    window.setTimeout(() => {
      syncFormFromQuery();
      maybeAutoSearch();
    }, 500);
    window.setTimeout(() => {
      syncFormFromQuery();
      maybeAutoSearch();
    }, 1500);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();
})();
