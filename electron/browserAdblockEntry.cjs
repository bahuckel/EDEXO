"use strict";

/*
  The EDEXO browser's blocking engine (plan 9.1): Ghostery's `@ghostery/adblocker` core (MPL-2.0), bundled by
  scripts/bundle.mjs into build/browser-adblock.cjs, which ships outside the asar (resources/edexo/) so a worker
  thread can load it. As a module it exports the engine; as a worker it parses the filter lists and hands the
  serialized engine back, so the main process — the one every window waits on — never parses them itself.
*/

const adblocker = require("@ghostery/adblocker");
const { FiltersEngine } = adblocker;
const { parse: parseHost } = require("tldts-experimental");
const wt = require("node:worker_threads");

if (!wt.isMainThread && wt.workerData && typeof wt.workerData.lists === "string") {
  try {
    const engine = FiltersEngine.parse(wt.workerData.lists, {
      loadCosmeticFilters: true,
      loadNetworkFilters: true,
      loadGenericCosmeticsFilters: true,
      // Scriptlets would need a script in the page's own world; the browser runs no preload (plan 9.2).
      loadExtendedSelectors: false,
      enableHtmlFiltering: false,
    });
    const bytes = engine.serialize();
    wt.parentPort.postMessage({ ok: true, bytes }, [bytes.buffer]);
  } catch (e) {
    wt.parentPort.postMessage({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
}

/** A URL's hostname and registrable domain ("www.edsm.net" → "edsm.net"), or nulls. */
function hostOf(url) {
  const r = parseHost(url);
  return { hostname: r.hostname ?? null, domain: r.domain ?? r.hostname ?? null };
}

module.exports = { FiltersEngine, Request: adblocker.Request, hostOf };
