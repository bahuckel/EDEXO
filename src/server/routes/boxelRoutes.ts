/*
  The Boxels screen's routes (split out of galaxyRoutes.ts, discuss item 30, 1.3.1): one boxel, the saved ones and
  their table, the Spansh look-ups, the boxels flown before and the screen's options.
*/
import { boxelSystems, boxelTable, previousBoxelsPage, type SystemStats } from "../boxel.js";
import { parseBoxel } from "../../shared/boxel.js";
import { createBoxelLookups } from "../boxelLookup.js";
import { resolveUserSettingsJsonPath } from "../paths.js";
import { boxelJournalFacts, notableBodiesForSystem, systemBodyTally } from "../snapshotSystemInfo.js";
import type { GameStateStore } from "../gameState.js";
import { getCachedSpeciesDatabase } from "../snapshot.js";
import path from "node:path";
import express from "express";
import { tileIndex, tileIndexAsync } from "../galaxyTiles.js";
import { touchGalaxyMemory } from "../galaxyMemory.js";
import { loadSystemTraits, loadSystemTraitsAsync } from "../galaxyTraits.js";
import { navRouteLog } from "../navRouteLog.js";
import type { HttpServerOptions, RouteContext } from "../httpServerTypes.js";

/** Bodies scanned and notable bodies per visited system, for the boxel lists (owner, 2026-09-30). */
function boxelStats(store: GameStateStore): SystemStats {
  return (addr) => ({
    bodies: systemBodyTally(store, addr),
    notable: notableBodiesForSystem(store, addr, null).length,
  });
}

export function registerBoxelRoutes(
  app: express.Express,
  opts: HttpServerOptions,
  _ctx: RouteContext,
): void {
  /*
    One boxel (shared/boxel.ts): `?name=` any system in it (or the boxel with a trailing "-"), `?end=`
    the last system number when known. Journals always; the galaxy index when this machine has it.
  */
  /*
    The Boxels screen reads the galaxy index too: it keeps the map's memory alive like /api/galaxy does.
    Without this the index was let go five idle minutes after the map closed and read again, whole, on the
    next Boxels open — a stall of seconds that froze the app (owner, 2026-10-06: "opening Boxels makes the
    app unresponsive").
  */
  app.use(["/api/boxel", "/api/boxels"], (_req, _res, next) => {
    touchGalaxyMemory();
    /*
      And reads it without stopping the server's thread (owner, 2026-10-06: "the moment I open Boxels it
      starts to lag … both launcher and in-app view"). The server runs in Electron's main process: the
      index, tiles, sector names and traits read synchronously there were ~0.7 s, longer on a cold disk,
      with every window frozen. Read off-thread and built in slices, the windows keep answering; the
      handlers' synchronous calls then find it all in place.
    */
    void Promise.all([tileIndexAsync(), loadSystemTraitsAsync()])
      .catch(() => undefined)
      .then(() => next());
  });
  app.get("/api/boxel", (req, res) => {
    const name = String(req.query.name ?? "").slice(0, 80);
    const endRaw = Number(req.query.end);
    const end =
      String(req.query.end ?? "").trim() !== "" && Number.isFinite(endRaw) ? Math.floor(endRaw) : null;
    const store = opts.getJournalStore?.() ?? null;
    const byId = new Map(getCachedSpeciesDatabase().species.map((s) => [s.id, s.displayName]));
    const dto = boxelSystems({
      query: name,
      end,
      index: tileIndex(),
      visited: store ? store.visitedSystems.entries() : [],
      speciesName: (id) => byId.get(id) ?? id,
      stats: store ? boxelStats(store) : undefined,
    });
    if (!dto) {
      res
        .status(400)
        .json({ ok: false, error: "Not a boxel name: type a system such as Eol Prou AB-C d1-23." });
      return;
    }
    res.json(dto);
  });

  /*
    Saved boxels (server/savedBoxels.ts): the commander types a boxel's last system, the list keeps it,
    and each read ticks off what the journals say he has flown.
  */
  // Spansh look-ups of whole boxels (server/boxelLookup.ts), kept 30 days beside the saved boxels.
  const lookups = createBoxelLookups({
    filePath: opts.savedBoxels
      ? path.join(path.dirname(resolveUserSettingsJsonPath()), "edexo-boxel-lookups.json")
      : null,
    isPlant: (genus) => {
      const g = genus.trim().toLowerCase();
      return getCachedSpeciesDatabase().species.some((s) => {
        const n = s.displayName.toLowerCase();
        return n === g || n.startsWith(`${g} `) || n.endsWith(` ${g}`);
      });
    },
  });
  /*
    Systems known to exist without being flown (auto-boxel detector, owner 2026-10-06): every route he
    plotted (the NavRoute finder) and every system he targeted in the galaxy map (journals' FSDTarget,
    Status.json's destination).
  */
  const sightings = (store: GameStateStore | null) => [
    ...navRouteLog().systems,
    ...(store ? [...store.targetedSystems.values()] : []),
  ];
  const savedList = () => {
    const store = opts.getJournalStore?.() ?? null;
    /*
      A Spansh look-up that knows systems past a saved boxel's end extends it (owner, 2026-10-06: "if it
      knows there are 17 systems, why do I have to click Extend"): they exist, as a route or a flight
      would prove.
    */
    for (const b of opts.savedBoxels!.list([])) {
      const looked = lookups.get(b.prefix);
      const highest = looked ? Math.max(-1, ...Object.keys(looked.systems).map(Number)) : -1;
      if (highest > b.end) opts.savedBoxels!.add(`${b.prefix}${highest}`);
    }
    return {
      ok: true,
      items: opts.savedBoxels!.list(
        store ? store.visitedSystems.entries() : [],
        store ? boxelStats(store) : undefined,
        store?.currentSystem ?? null,
        sightings(store),
      ),
      autoCopyNext: opts.savedBoxels!.autoCopyNext(),
    };
  };
  app.get("/api/boxels", (_req, res) => {
    if (!opts.savedBoxels)
      return void res.status(501).json({ ok: false, error: "Not available in this build." });
    res.json(savedList());
  });
  /*
    `{ lastSystem }` keeps a boxel to that system. `{ system, end? }` (the Boxels screen's Current boxel
    and Plan): any system of the boxel; with no end, up to the highest system the journals or the
    galaxy index know (at least the one named), and a boxel already saved keeps its own end.
  */
  app.post("/api/boxels", (req, res) => {
    if (!opts.savedBoxels)
      return void res.status(501).json({ ok: false, error: "Not available in this build." });
    let last = typeof req.body?.lastSystem === "string" ? req.body.lastSystem : "";
    if (typeof req.body?.system === "string") {
      const b = parseBoxel(req.body.system.slice(0, 80));
      if (!b) {
        res
          .status(400)
          .json({ ok: false, error: "Not a boxel name: type a system such as Eol Prou AB-C d1-23." });
        return;
      }
      const endRaw = Number(req.body.end);
      const asked =
        req.body.end != null && req.body.end !== "" && Number.isFinite(endRaw) ? Math.floor(endRaw) : null;
      const have = savedList().items.find((x) => x.prefix.toLowerCase() === b.prefix.toLowerCase());
      if (have && asked == null) return void res.json({ ...savedList(), id: have.id });
      const store = opts.getJournalStore?.() ?? null;
      const auto = boxelSystems({
        query: req.body.system,
        end: asked,
        index: tileIndex(),
        visited: store ? store.visitedSystems.entries() : [],
        speciesName: (id) => id,
      });
      last = `${b.prefix}${auto?.end ?? b.index ?? 0}`;
    }
    const added = opts.savedBoxels.add(last);
    if (!added) {
      res
        .status(400)
        .json({ ok: false, error: "Type the boxel's last system in full, such as Eol Prou AB-C d1-57." });
      return;
    }
    res.json({ ...savedList(), id: added.id });
  });
  /*
    The Boxels screen's table: `?ids=` the ticked saved boxels (comma-separated), every system of each,
    with what the journals and the galaxy index say.
  */
  app.get("/api/boxels/table", (req, res) => {
    if (!opts.savedBoxels)
      return void res.status(501).json({ ok: false, error: "Not available in this build." });
    const want = new Set(
      String(req.query.ids ?? "")
        .split(",")
        .filter(Boolean),
    );
    const store = opts.getJournalStore?.() ?? null;
    const byId = new Map(getCachedSpeciesDatabase().species.map((s) => [s.id, s.displayName]));
    res.json({
      ok: true,
      ...boxelTable({
        boxels: savedList().items.filter((b) => want.has(b.id)),
        index: tileIndex(),
        visited: store ? store.visitedSystems.entries() : [],
        speciesName: (id) => byId.get(id) ?? id,
        traits: loadSystemTraits(),
        journal: store ? (addr) => boxelJournalFacts(store, addr) : undefined,
        visitedAt: (addr) => store?.systemVisitedAt.get(addr) ?? null,
        lookup: (prefix) => lookups.get(prefix),
        routed: sightings(store),
      }),
    });
  });
  /*
    Look a saved boxel up on Spansh (plan Q1): `POST /api/boxels/:id/lookup` starts it (one at a time,
    pages five seconds apart), `GET /api/boxels/lookup` says how far it is, `DELETE` stops it.
  */
  app.post("/api/boxels/:id/lookup", (req, res) => {
    if (!opts.savedBoxels)
      return void res.status(501).json({ ok: false, error: "Not available in this build." });
    const b = savedList().items.find((x) => x.id === String(req.params.id ?? ""));
    if (!b) return void res.status(404).json({ ok: false, error: "No such saved boxel." });
    const started = lookups.start(b.prefix);
    res.status(started ? 200 : 409).json({
      ok: started,
      status: lookups.status(),
      ...(started ? {} : { error: "A look-up is already running." }),
    });
  });
  app.get("/api/boxels/lookup", (_req, res) => res.json({ ok: true, status: lookups.status() }));
  app.delete("/api/boxels/lookup", (_req, res) => {
    lookups.stop();
    res.json({ ok: true, status: lookups.status() });
  });
  /*
    Boxels he flew through (Previous): `?days=` the last visit within that many days (0 or none: all),
    notable ones first.
  */
  app.get("/api/boxels/previous", (req, res) => {
    const store = opts.getJournalStore?.() ?? null;
    if (!store) return void res.json({ ok: true, items: [] });
    const days = Math.max(0, Number(req.query.days) || 0);
    const saved = new Set((opts.savedBoxels ? savedList().items : []).map((b) => b.prefix.toLowerCase()));
    // A page at a time, newest first: `offset`, `limit` (default 40, at most 200), `q` to search.
    const offset = Math.max(0, Math.floor(Number(req.query.offset) || 0));
    const limit = Math.min(200, Math.max(1, Math.floor(Number(req.query.limit) || 40)));
    const page = previousBoxelsPage({
      visited: store.visitedSystems.entries(),
      visitedAt: (addr) => store.systemVisitedAt.get(addr) ?? null,
      journal: (addr) => boxelJournalFacts(store, addr),
      sinceIso: days ? new Date(Date.now() - days * 86_400_000).toISOString() : null,
      savedPrefixes: saved,
      query: String(req.query.q ?? "").slice(0, 80),
      offset,
      limit,
    });
    res.json({ ok: true, ...page, offset });
  });
  // Copy the next system to fly after each jump into a saved boxel: `{ autoCopyNext: boolean }`.
  app.post("/api/boxels/options", (req, res) => {
    if (!opts.savedBoxels)
      return void res.status(501).json({ ok: false, error: "Not available in this build." });
    if (typeof req.body?.autoCopyNext === "boolean") opts.savedBoxels.setAutoCopyNext(req.body.autoCopyNext);
    res.json(savedList());
  });
  // A correction on one system: `{ cutFrom: n }` drops n and everything after; `{ skip: n, on }`.
  app.patch("/api/boxels/:id", (req, res) => {
    if (!opts.savedBoxels)
      return void res.status(501).json({ ok: false, error: "Not available in this build." });
    const id = String(req.params.id ?? "");
    const body = (req.body ?? {}) as Record<string, unknown>;
    let done = false;
    if (typeof body.cutFrom === "number") done = opts.savedBoxels.cutFrom(id, body.cutFrom);
    else if (typeof body.skip === "number")
      done = opts.savedBoxels.setSkipped(id, body.skip, body.on !== false);
    // The galaxy-map probe: `{ lastIs: n }` — he checked that n + 1 is not there, so n is the last.
    else if (typeof body.lastIs === "number") done = opts.savedBoxels.confirmEnd(id, body.lastIs);
    // The boxel run (server/boxelRun.ts): `{ run: true }` makes this boxel the run, `{ run: false }` ends it.
    else if (typeof body.run === "boolean") done = opts.savedBoxels.setRun(body.run ? id : null);
    if (!done) {
      res.status(400).json({ ...savedList(), ok: false, error: "That system is not in this saved boxel." });
      return;
    }
    res.json(savedList());
  });
  app.delete("/api/boxels/:id", (req, res) => {
    if (!opts.savedBoxels)
      return void res.status(501).json({ ok: false, error: "Not available in this build." });
    const gone = opts.savedBoxels.remove(String(req.params.id ?? ""));
    res.status(gone ? 200 : 404).json({ ...savedList(), ok: gone });
  });
}
