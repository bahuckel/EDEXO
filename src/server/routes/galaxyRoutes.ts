
import { getCachedSpeciesDatabase } from "../snapshot.js";
import express from "express";
import { getProjectRoot } from "../paths.js";
import { perfCount } from "../perf.js";
import { clearGalaxyPoints, galaxyPointsAsync } from "../galaxyPoints.js";
import {
  clearTileIndex,
  encodeCells,
  encodeTile,
  parseCellParam,
  sectorNames,
  tileIndex,
  tileIndexAsync,
} from "../galaxyTiles.js";
import { registerGalaxyCache, touchGalaxyMemory } from "../galaxyMemory.js";
import { clearBioBodiesCache } from "../bioBodies.js";
import {
  clearBioIndexCache,
  loadBioIndexAsync,
  TIER_BODIES_KNOWN,
  TIER_CODEX,
  TIER_DSS,
  TIER_FSS,
} from "../bioIndex.js";
import {
  clearGalaxyCatalogueCache,
  clearGalaxySystemValues,
  galaxySystemSpecies,
  galaxySystemValues,
} from "../galaxyValueSearch.js";
import {
  clearSystemTraits,
  galaxyFilterMask,
  loadSystemTraits,
  loadSystemTraitsAsync,
  systemTraitCounts,
} from "../galaxyTraits.js";
import { downloadGalaxyIndex, galaxyIndexStatus, probeGalaxyIndexSize } from "../galaxyIndexFiles.js";
import { checkNavRouteSystemsOnEdsm, clearNavRouteLog, lastNavRoute, navRouteLog } from "../navRouteLog.js";
import { BODY_TRAIT_GROUP, BODY_TRAITS, STAR_CLASSES } from "../../shared/galaxyTraits.js";
import { loadRegionMap } from "../regionMapData.js";
import { galaxyFind, galaxySector } from "../galaxyFind.js";
import { doneAddresses, MAX_PLAN_STOPS, nextTarget, ordinalsOf } from "../galaxyNext.js";
import type { GalaxyFindDTO, GalaxySystemDTO } from "../../shared/dto/galaxy.js";
import { ownCarrierNow } from "../../shared/ownAssets.js";
import { id64Boxel } from "../../shared/id64.js";
import type { HttpServerOptions, RouteContext } from "../httpServerTypes.js";
import { galaxyLayer, type GalaxyLayerKind } from "../galaxyLayers.js";
import { GALAXY_LAYER_KINDS } from "../../shared/galaxyLayers.js";
import { clearBarrenTable } from "../boxelBarren.js";
import {
  clearStationsIndex,
  downloadStations,
  loadStationsIndex,
  probeStationsRelease,
  stationsStatus,
} from "../stationsIndex.js";
import {
  clearNeutronIndex,
  downloadNeutrons,
  neutronsStatus,
  probeNeutronsRelease,
} from "../neutronIndex.js";
import {
  clearJumponiumIndex,
  downloadJumponium,
  jumponiumIndexStatus,
  probeJumponiumRelease,
} from "../jumponiumIndex.js";

export function registerGalaxyRoutes(
  app: express.Express,
  opts: HttpServerOptions,
  ctx: RouteContext,
): void {
  // The map's extra layers (galaxyLayers.ts): points of interest, phenomena, carriers, bookmarks.
  app.get("/api/galaxy/layers", (req, res) => {
    // Registered ahead of the /api/galaxy middleware below, and the stations layer reads a registered cache.
    touchGalaxyMemory();
    const kind = String(req.query?.kind ?? "") as GalaxyLayerKind;
    if (!GALAXY_LAYER_KINDS.includes(kind)) {
      res.status(400).json({ ok: false, error: `kind must be one of ${GALAXY_LAYER_KINDS.join(", ")}` });
      return;
    }
    res.json(galaxyLayer(kind, opts.bookmarks, Date.now(), opts.ownGreenGiants));
  });

  /**
   * Cheap status for the launcher window. It polls every 2.5 s and only renders a lamp, the journal
   * folder, a file count and the connect URLs — but it used to call /api/state, which rebuilds the
   * whole snapshot (~186 ms, ~630 KB) and consumed the one-shot auto-select key. This endpoint
   * reads store fields directly and allocates nothing.
   */
  /**
   * The sector heat map's data (Phase 10 step 3).
   *
   * Served from `data/exomastery/sector-map.json`, which the feeder writes — the app never opens the
   * corpus store. Read on demand rather than held in the snapshot: it is 87 kB, the map is one
   * screen among many, and most sessions never open it.
   *
   * A missing file is a 404 rather than an error. The map is a derived artefact; a build that has
   * not run the feeder should show "no map yet", not a broken app.
   */
  /**
   * The vendored region map, for the galaxy backdrop.
   *
   * 179 kB of run-length rows, served whole and cached hard: it is checked-in data that changes only
   * when the file is replaced, and the client paints it once into a canvas. Sent from disk rather
   * than through the decoder so the bytes on the wire are the bytes in the repo, notice and all.
   */
  /*
    What under /api/galaxy reads these keeps the map's memory alive (journal-only routes do not, see
    JOURNAL_ONLY); five idle minutes lets it go (galaxyMemory.ts — the map is its own window, loaded
    fresh each time, owner 2026-09-28).
  */
  registerGalaxyCache("bio-index", clearBioIndexCache);
  registerGalaxyCache("species-catalogue", clearGalaxyCatalogueCache);
  registerGalaxyCache("points", clearGalaxyPoints);
  registerGalaxyCache("tiles", clearTileIndex);
  registerGalaxyCache("system-values", clearGalaxySystemValues);
  registerGalaxyCache("boxel-barren", clearBarrenTable);
  registerGalaxyCache("stations", clearStationsIndex);
  registerGalaxyCache("neutrons", clearNeutronIndex);
  registerGalaxyCache("jumponium", clearJumponiumIndex);
  registerGalaxyCache("system-traits", clearSystemTraits);
  // The galaxy body file (683 MB since version 2) was the one dataset never let go: a single "possible"
  // search kept it for the rest of the session (plan 4.1, 2026-10-10).
  registerGalaxyCache("bio-bodies", clearBioBodiesCache);
  /*
    And what a request reads synchronously is read off the main thread before it (owner, 2026-10-07: the app went
    "Not responding" for a moment as the map loaded — the server shares Electron's main process, as Boxels found).
    Only for the requests that read it (2026-10-26): every other galaxy request used to wait for the tile index and
    the traits too, so the sector map's search panel asking for its region list (`/regions`, an answer from the body
    file's summary) loaded ~360 MB it never read, held for five idle minutes. The rest load what they need themselves
    (`loadBioIndexAsync`, `galaxyPointsAsync`) or read only the journal.
  */
  const NEEDS_TILES = new Set(["/cells", "/sector-names", "/sector", "/tile", "/find"]);
  const NEEDS_TRAITS = new Set(["/traits", "/filter"]);
  /*
    These read only the journal store or the download's status, so they do not keep the map's memory
    alive (code review, 2026-10-14): the map's route and own-assets polls kept resetting the idle clock,
    and nothing was ever let go while a map tab was open, in front or not. /mine/system (the bio index)
    reads a registered cache and touches it; /layers is registered above and touches it itself.
  */
  const JOURNAL_ONLY = new Set([
    "/index",
    "/index/download",
    "/route",
    "/visited",
    "/mine",
    "/my-sectors",
    "/own",
    "/finder/status",
    "/finder/download",
  ]);
  app.use("/api/galaxy", (req, _res, next) => {
    if (!JOURNAL_ONLY.has(req.path)) touchGalaxyMemory();
    const tiles = NEEDS_TILES.has(req.path);
    const traits = NEEDS_TRAITS.has(req.path);
    if (!tiles && !traits) return next();
    void Promise.all([tiles ? tileIndexAsync() : null, traits ? loadSystemTraitsAsync() : null])
      .catch(() => undefined)
      .then(() => next());
  });

  const sendBinary = (res: express.Response, buf: Buffer) => {
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.send(buf);
  };
  const noIndex = (res: express.Response) =>
    res.status(404).json({ ok: false, error: "No galaxy index in this build." });

  /**
   * Every bio-index system as quantised points: the 3D map's overview (layout in galaxyPoints.ts).
   * `?stride=4|16` thins it for a machine drawing WebGL in software.
   */
  app.get("/api/galaxy/points", async (req, res) => {
    const stride = [1, 4, 16].includes(Number(req.query.stride)) ? Number(req.query.stride) : 1;
    const buf = await galaxyPointsAsync(stride);
    if (!buf) return void noIndex(res);
    sendBinary(res, buf);
  });

  /**
   * The map's Bodies filters (owner, 2026-10-04): every star class and body trait with how many
   * systems hold it. `available: false` on a build without `system-traits.bin.gz`.
   */
  app.get("/api/galaxy/traits", (_req, res) => {
    const traits = loadSystemTraits();
    if (!traits) {
      res.json({ available: false, mainStars: [], stars: [], planets: [], features: [] });
      return;
    }
    const c = systemTraitCounts(traits);
    const rows = (list: readonly { key: string; label: string }[], counts: number[]) =>
      list.map((t, i) => ({ key: t.key, label: t.label, count: counts[i] ?? 0 }));
    const bodies = rows(BODY_TRAITS, c.bodies);
    res.json({
      available: true,
      mainStars: rows(STAR_CLASSES, c.main).filter((r) => r.key !== "SG"),
      stars: rows(STAR_CLASSES, c.stars),
      /*
        Only what the index holds: galaxy_bio.jsonl keeps the planets that matter for biology, so the
        Class I-V and Helium gas giants are never in it and a tick on them could only empty the map.
      */
      planets: bodies.filter((r) => BODY_TRAIT_GROUP[r.key] === "Planet type" && r.count > 0),
      /*
        The dump keeps every star but only the planets that matter for biology, so "landable" and
        "landable with atmosphere" hold 95-98 % of systems: not a filter. Kept in the file, not offered.
      */
      features: bodies.filter((r) => BODY_TRAIT_GROUP[r.key] === "Features" && !r.key.startsWith("landable")),
    });
  });

  /**
   * Which systems pass the map's filter, as bits over bio-index ordinals (galaxyTraits.ts):
   * `?genera=stratum&species=…&mainStars=N&stars=…&planets=elw&features=terraformable`, each a comma
   * list. Layout: "EDXFLT01", u32 system count, u32 matched, then the bits.
   */
  app.get("/api/galaxy/filter", async (req, res) => {
    // Read off the server's thread when not held (audit 2026-10-22): the synchronous loader stops every window.
    const index = await loadBioIndexAsync();
    if (!index) return void noIndex(res);
    const list = (k: string) =>
      String(req.query[k] ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 200);
    const genusOf = new Map(getCachedSpeciesDatabase().species.map((e) => [e.id, e.genusDataDir]));
    const { bits, matched } = galaxyFilterMask(
      {
        species: list("species"),
        genera: list("genera"),
        mainStars: list("mainStars"),
        stars: list("stars"),
        planets: list("planets"),
        features: list("features"),
      },
      index,
      loadSystemTraits(),
      (id) => genusOf.get(id) ?? null,
    );
    const buf = Buffer.alloc(16 + bits.length);
    buf.write("EDXFLT01", 0, "ascii");
    buf.writeUInt32LE(index.systemCount, 8);
    buf.writeUInt32LE(matched, 12);
    buf.set(bits, 16);
    sendBinary(res, buf);
  });

  /**
   * The galaxy index as a separate download (plan 4.2, 2026-10-04): whether it is here, how big the
   * download is, and its progress; POST starts it. Builds leave the files out.
   */
  /*
    One download for the map's data (owner, 2026-10-13: "combined index"): the galaxy index, then the stations and
    the neutron stars, each from the same release. Their own tabs still offer them alone; the status says what
    is missing and what the whole download weighs.
  */
  const extrasStatus = () => {
    const st = stationsStatus();
    const nt = neutronsStatus();
    const jp = jumponiumIndexStatus();
    // Due: not here, or the release has another build (its count differs) — what the download fetches.
    return {
      stations: {
        present: st.present,
        due: !st.present || (st.release != null && st.release.stations !== st.stations),
        downloading: st.downloading,
        error: st.error,
        bytes: st.release?.bytes ?? null,
      },
      neutrons: {
        present: nt.present,
        due: !nt.present || (nt.release != null && nt.release.neutrons !== nt.neutrons),
        downloading: nt.downloading,
        error: nt.error,
        bytes: nt.release?.bytes ?? null,
      },
      jumponium: {
        present: jp.present,
        due: !jp.present || (jp.release != null && jp.release.bodies !== jp.bodies),
        downloading: jp.downloading,
        error: jp.error,
        bytes: jp.release?.bytes ?? null,
      },
    };
  };
  const combinedStatus = () => {
    const st = galaxyIndexStatus();
    const ex = extrasStatus();
    const missing = [ex.stations, ex.neutrons, ex.jumponium].filter((x) => x.due);
    const extraBytes = missing.reduce((a, x) => a + (x.bytes ?? 0), 0);
    // Progress of whichever part is coming down.
    const downloading =
      st.downloading ??
      (ex.stations.downloading ? { name: "stations.bin.gz", ...ex.stations.downloading } : null) ??
      (ex.neutrons.downloading ? { name: "neutrons.bin.gz", ...ex.neutrons.downloading } : null) ??
      (ex.jumponium.downloading ? { name: "laboratory.bin.gz", ...ex.jumponium.downloading } : null);
    return {
      ...st,
      downloading,
      error: st.error ?? ex.stations.error ?? ex.neutrons.error ?? ex.jumponium.error,
      extras: ex,
      // The whole download is under way (between two parts nothing is coming down for a moment).
      busy: combinedRunning,
      extrasMissing: missing.length,
      extraBytes,
      downloadBytes: st.downloadBytes != null ? st.downloadBytes + extraBytes : null,
    };
  };
  let indexProbedAt = 0;
  app.get("/api/galaxy/index", async (_req, res) => {
    const st = galaxyIndexStatus();
    // The release's sizes (HEAD requests), at most every ten minutes: the download and the update check.
    if ((st.downloadBytes == null || st.updateAvailable == null) && Date.now() - indexProbedAt > 600_000) {
      indexProbedAt = Date.now();
      await Promise.all([probeGalaxyIndexSize(), probeStationsRelease(), probeNeutronsRelease(), probeJumponiumRelease()]);
    }
    res.json(combinedStatus());
  });
  let combinedRunning = false;
  app.post("/api/galaxy/index/download", (req, res) => {
    // `{ extrasOnly: true }`: the index is current, only the stations and neutron stars are missing.
    const extrasOnly = (req.body as { extrasOnly?: unknown } | undefined)?.extrasOnly === true;
    if (!combinedRunning) {
      combinedRunning = true;
      void (async () => {
        try {
          if (!extrasOnly)
            await downloadGalaxyIndex(() => {
              clearBioIndexCache();
              clearSystemTraits();
              clearGalaxyPoints();
              clearTileIndex();
              clearGalaxyCatalogueCache();
              clearGalaxySystemValues();
            });
          // Each only when not here or newer on the release (review 1.2.16: both came down again every time).
          const ex = extrasStatus();
          if (ex.stations.due) await downloadStations(() => opts.scheduleBroadcast?.());
          if (ex.neutrons.due) await downloadNeutrons(() => opts.scheduleBroadcast?.());
          if (ex.jumponium.due) await downloadJumponium(() => opts.scheduleBroadcast?.());
        } finally {
          combinedRunning = false;
        }
      })();
    }
    res.json({ ok: true });
  });

  /**
   * The NavRoute star finder (owner, 2026-10-04): every plotted route's systems with their star class,
   * EDSM's answer per system once asked, and the check in progress. Not under /api/galaxy's memory
   * clock: it is the commander's own small list.
   */
  app.get("/api/navroutes", (_req, res) => {
    res.json({ ...navRouteLog(), last: lastNavRoute().map((s) => s.address) });
  });
  /** `{ addresses: number[] }` — ask EDSM about these (at most 2,000), in the background. */
  app.post("/api/navroutes/edsm-check", (req, res) => {
    const raw = (req.body as { addresses?: unknown } | undefined)?.addresses;
    const addresses = Array.isArray(raw)
      ? raw.filter((a): a is number => typeof a === "number" && Number.isFinite(a)).slice(0, 2000)
      : [];
    if (!addresses.length) {
      res.status(400).json({ ok: false, error: "addresses: a list of system addresses" });
      return;
    }
    void checkNavRouteSystemsOnEdsm(addresses);
    res.json({ ok: true });
  });
  app.delete("/api/navroutes", (_req, res) => {
    clearNavRouteLog();
    res.json({ ok: true });
  });

  /** The non-empty 1,280 ly cells and their system counts (layout in galaxyTiles.ts). */
  app.get("/api/galaxy/cells", (_req, res) => {
    const t = tileIndex();
    if (!t) return void noIndex(res);
    sendBinary(res, encodeCells(t));
  });

  /** Each cell's sector name, same order as `/api/galaxy/cells` ("" where none). */
  app.get("/api/galaxy/sector-names", (_req, res) => {
    const t = tileIndex();
    if (!t) return void noIndex(res);
    res.json(sectorNames(t));
  });

  /** Names by system ordinal, for the map's labels: `?i=1,2,3` (at most 400). */
  app.get("/api/galaxy/names", async (req, res) => {
    const index = await loadBioIndexAsync();
    if (!index) return void noIndex(res);
    const ids = String(req.query.i ?? "")
      .split(",")
      .slice(0, 400)
      .map(Number)
      .filter((i) => Number.isInteger(i) && i >= 0 && i < index.systemCount);
    const out: Record<number, string> = {};
    for (const i of ids) out[i] = index.nameOf(i);
    res.json(out);
  });

  /** One system for the map's panel: `?i=<ordinal>`, or `?addr=<id64>` (a search hit, a journal system). */
  app.get("/api/galaxy/system", async (req, res) => {
    const index = await loadBioIndexAsync();
    if (!index) return void noIndex(res);
    let i = Number(req.query.i);
    if (req.query.addr != null) {
      try {
        i = index.ordinalOf(BigInt(String(req.query.addr)));
      } catch {
        i = -1;
      }
      if (i < 0) return void res.status(404).json({ ok: false, error: "not in the galaxy index" });
    }
    if (!Number.isInteger(i) || i < 0 || i >= index.systemCount) {
      return void res.status(400).json({ ok: false, error: "i must be a system ordinal" });
    }
    const s = index.systemAt(i);
    const species = galaxySystemSpecies(index, s.species);
    const regions = loadRegionMap(getProjectRoot())?.regions;
    const dto: GalaxySystemDTO = {
      ordinal: i,
      id64: s.id64.toString(),
      name: s.name,
      x: s.x,
      y: s.y,
      z: s.z,
      region: (s.regionId && regions?.[s.regionId]) || null,
      bodyCount: s.bodyCount || null,
      evidence: {
        fss: (s.tiers & TIER_FSS) !== 0,
        dss: (s.tiers & TIER_DSS) !== 0,
        codex: (s.tiers & TIER_CODEX) !== 0,
        bodiesKnown: (s.tiers & TIER_BODIES_KNOWN) !== 0,
      },
      species,
      valueCr: species.reduce((a, sp) => a + (sp.baseCr ?? 0), 0),
      distanceFromSolLy: Math.hypot(s.x, s.y, s.z),
    };
    res.json(dto);
  });

  /**
   * Next target: the nearest system to the ship worth at least `min` (100 k CR units, 1×) that the
   * commander has not analysed (DSS or foot scans; `skipVisited=1` also skips anything visited), not
   * counting `exclude` (ordinals skipped this session, at most 2,000). `plan=N` (≤ 20) adds a plan of
   * N stops from the ship (G5.3): chosen by a greedy chain, ordered by 2-opt (5.8); `loop=1` returns
   * to the ship.
   */
  app.get("/api/galaxy/next", async (req, res) => {
    const index = await loadBioIndexAsync();
    if (!index) return void noIndex(res);
    const store = opts.getJournalStore?.() ?? null;
    const exclude = new Set(
      String(req.query.exclude ?? "")
        .split(",")
        .slice(0, 2000)
        .map(Number)
        .filter((i) => Number.isInteger(i) && i >= 0),
    );
    if (store) {
      const done = doneAddresses(store);
      for (const i of ordinalsOf(index, done.analysed)) exclude.add(i);
      if (req.query.skipVisited === "1") for (const i of ordinalsOf(index, done.visited)) exclude.add(i);
    }
    const min = Math.max(0, Math.min(65535, Number(req.query.min) || 0));
    const plan = Math.max(0, Math.min(MAX_PLAN_STOPS, Math.floor(Number(req.query.plan) || 0)));
    const from = store?.commanderPos ?? opts.getCommanderPosition?.() ?? null;
    res.json(
      nextTarget(index, galaxySystemValues(index), from, min, exclude, 6, plan, req.query.loop === "1"),
    );
  });

  // The boxels (boxelRoutes.ts) and the discoveries, achievements and codex maps (discoveriesRoutes.ts) were here
  // (split out, discuss item 30, 1.3.1); registered in the same order, from httpServer.ts.

  /** Regions are the client's; this finds sectors and systems by name: `?q=`. */
  app.get("/api/galaxy/find", (req, res) => {
    const t = tileIndex();
    if (!t) return void noIndex(res);
    const q = String(req.query.q ?? "").slice(0, 80);
    const found = galaxyFind(t, opts.getJournalStore?.() ?? null, q, opts.getImportedSystems?.() ?? []);
    // Stations by name, when they are downloaded (owner, 2026-10-13); a duplicated name says its system.
    let stations: NonNullable<GalaxyFindDTO["stations"]> = [];
    if (stationsStatus().present) {
      const mine = new Set((opts.getJournalStore?.()?.ownAssets.colonies ?? []).map((c) => c.name.toLowerCase()));
      try {
        stations = (loadStationsIndex()?.search(q) ?? []).map((r) => ({
          own: mine.has(r.system.toLowerCase()),
          name: r.name,
          system: r.system,
          label: r.dup ? `${r.name} (${r.system})` : r.name,
          type: r.type,
          pad: r.pad,
          x: r.x,
          y: r.y,
          z: r.z,
          layerId: r.sys,
        }));
      } catch {
        stations = [];
      }
    }
    res.json({ ...found, stations });
  });

  /** A sector column's panel: `?c=cx:cz` (every height together, as the map's rings are). */
  app.get("/api/galaxy/sector", (req, res) => {
    const m = /^(-?\d{1,3}):(-?\d{1,3})$/.exec(String(req.query.c ?? ""));
    if (!m) return void res.status(400).json({ ok: false, error: "c must be cx:cz" });
    const t = tileIndex();
    if (!t) return void noIndex(res);
    const dto = galaxySector(t, Number(m[1]), Number(m[2]));
    if (!dto) return void res.status(404).json({ ok: false, error: "empty sector" });
    res.json(dto);
  });

  /** One cell's systems at 0.02 ly: `?c=cx:cy:cz`. An empty cell is a 404, not an error. */
  app.get("/api/galaxy/tile", (req, res) => {
    const c = parseCellParam(req.query.c);
    if (!c) return void res.status(400).json({ ok: false, error: "c must be cx:cy:cz" });
    const t = tileIndex();
    if (!t) return void noIndex(res);
    const buf = encodeTile(t, c);
    if (!buf) return void res.status(404).json({ ok: false, error: "empty cell" });
    sendBinary(res, buf);
  });

  /** The commander's own systems with what they did there (G3; flags in galaxyMine.ts). */
  /*
    The commander's own carrier and colonised systems, for the map's badges (owner, 2026-10-13; shared/ownAssets.ts):
    where each is from the journals' StarPos, else the boxel's centre from its address (within a boxel of it).
  */
  const ownAssets = () => {
    const store = opts.getJournalStore?.() ?? null;
    if (!store) return { carrier: null, colonies: [] };
    const place = (s: { name: string; addr: number } | null) => {
      if (!s) return null;
      const p = store.systemPositions.get(s.addr);
      if (p) return { name: s.name, x: p.x, y: p.y, z: p.z, exact: true };
      // Above 2^53 the journal's number has lost the low bits the mass code is in: no guess (review 1.2.16).
      const b = Number.isSafeInteger(s.addr) ? id64Boxel(s.addr) : null;
      return b ? { name: s.name, ...b.center, exact: false } : null;
    };
    return {
      carrier: place(ownCarrierNow(store.ownAssets)),
      colonies: store.ownAssets.colonies.map(place).filter((c) => c != null),
    };
  };
  app.get("/api/galaxy/own", (_req, res) => res.json(ownAssets()));
  // The map's badges follow a carrier jump or a new colony when this changes (R2: was a poll every minute).
  ctx.watchTopic("galaxy-own", ownAssets);

  app.get("/api/galaxy/mine", (_req, res) => {
    if (!opts.getMySystems) return void res.status(404).json({ error: "no journal store behind this build" });
    res.json(opts.getMySystems());
  });

  /** One of them, body by body: `?addr=<SystemAddress>`. */
  app.get("/api/galaxy/mine/system", async (req, res) => {
    const addr = Number(req.query.addr);
    if (!Number.isFinite(addr)) return void res.status(400).json({ error: "addr must be a SystemAddress" });
    // The middleware does not read the index for it, and getMySystem reads it synchronously: read it here first.
    await loadBioIndexAsync();
    const dto = opts.getMySystem?.(addr) ?? null;
    if (!dto) return void res.status(404).json({ error: "not one of your systems" });
    res.json(dto);
  });

  /** The systems you have been to, newest first: `?days=1|7|30|90|365`, or 0 / absent for all. */
  app.get("/api/galaxy/visited", (req, res) => {
    if (!opts.getVisitedSystems)
      return void res.status(404).json({ error: "no journal store behind this build" });
    const days = Math.max(0, Math.min(100_000, Math.floor(Number(req.query.days) || 0)));
    res.json(opts.getVisitedSystems(days));
  });

  /** Where the ship is and this session's jumps with positions. */
  app.get("/api/galaxy/route", (_req, res) => {
    if (!opts.getSessionRoute)
      return void res.status(404).json({ error: "no journal store behind this build" });
    res.json(opts.getSessionRoute());
  });
  // The ship, the session's jumps and the plotted route (R2: the map asked every 15-30 s, the Next panel every 3 s).
  if (opts.getSessionRoute) ctx.watchTopic("galaxy-route", opts.getSessionRoute);

  app.get("/api/galaxy/my-sectors", (_req, res) => {
    perfCount("http.commanderSectors");
    if (!opts.getCommanderSectors) {
      res.status(404).json({ error: "no journal store behind this build" });
      return;
    }
    res.json(opts.getCommanderSectors());
  });

  app.get("/api/galaxy/species", async (_req, res) => {
    perfCount("http.galaxySpecies");
    if (!opts.getGalaxySpecies) {
      res.status(404).json({ error: "no galaxy index in this build" });
      return;
    }
    await loadBioIndexAsync();
    res.json(opts.getGalaxySpecies());
  });

  app.get("/api/galaxy/regions", (_req, res) => {
    perfCount("http.galaxyRegions");
    if (!opts.getGalaxyRegions) {
      res.status(404).json({ error: "no galaxy body file on this machine" });
      return;
    }
    res.json(opts.getGalaxyRegions());
  });

  /**
   * Bodies that could hold a species, in places nobody has looked.
   *
   * The evidence ticks arrive as three independent booleans rather than a mode, because that is
   * what they are: FSS-only, already probed, and already walked are separate questions and the
   * commander may want any combination. Defaults match the panel's — untouched bodies only.
   */
  app.get("/api/galaxy/possible", (req, res) => {
    perfCount("http.galaxyPossible");
    if (!opts.scanGalaxyBodies) {
      res.status(404).json({ error: "no galaxy body file on this machine" });
      return;
    }
    const regionId = Number(req.query.regionId ?? 0);
    if (!Number.isFinite(regionId) || regionId <= 0) {
      res.status(400).json({ error: "regionId must be a positive region index" });
      return;
    }
    const limit = Number(req.query.limit ?? 200);
    const list = (v: unknown): string[] | undefined => {
      const raw = String(v ?? "").trim();
      if (!raw) return undefined;
      const parts = raw
        .split(",")
        .map((p) => p.trim())
        .filter(Boolean);
      return parts.length ? parts : undefined;
    };
    // Absent means the default, so `fss=0` can turn the default off — `!== "0"` would read a
    // missing parameter as a tick the commander never made.
    const tick = (v: unknown, fallback: boolean): boolean => {
      const raw = String(v ?? "").trim();
      if (!raw) return fallback;
      return raw === "1" || raw.toLowerCase() === "true";
    };
    opts
      .scanGalaxyBodies(
        {
          regionId: Math.trunc(regionId),
          speciesIds: list(req.query.species),
          genusDirs: list(req.query.genus),
          includeUnprobed: tick(req.query.fss, true),
          includeProbed: tick(req.query.dss, false),
          includeWalked: tick(req.query.walked, false),
          // Absent or 0 means no floor, which is the default; see GalaxyBodyScanQueryDTO.
          minGravityOddsPct: Number(req.query.minGravityOdds ?? 0) || 0,
        },
        Number.isFinite(limit) ? limit : 200,
      )
      .then((dto) => res.json(dto))
      .catch((e: unknown) => {
        console.warn(`ED Exo Compare — galaxy body scan failed: ${String(e)}`);
        res.status(500).json({ error: "the galaxy body scan failed" });
      });
  });

  app.get("/api/galaxy/worth", async (req, res) => {
    perfCount("http.galaxyWorth");
    if (!opts.searchGalaxyByValue) {
      res.status(404).json({ error: "no galaxy index in this build" });
      return;
    }
    const minCr = Number(req.query.minCr ?? 0);
    const limit = Number(req.query.limit ?? 200);
    if (!Number.isFinite(minCr) || minCr < 0) {
      res.status(400).json({ error: "minCr must be a non-negative number" });
      return;
    }
    /** Comma-separated so the whole query stays a GET a human can read in a log. */
    const list = (v: unknown): string[] | undefined => {
      const raw = String(v ?? "").trim();
      if (!raw) return undefined;
      const parts = raw
        .split(",")
        .map((p) => p.trim())
        .filter(Boolean);
      return parts.length ? parts : undefined;
    };
    const tiers = Number(req.query.tiers ?? 0);
    await loadBioIndexAsync();
    res.json(
      opts.searchGalaxyByValue(
        {
          minCr,
          speciesIds: list(req.query.species),
          genusDirs: list(req.query.genus),
          requireTiers: Number.isFinite(tiers) && tiers > 0 ? tiers : 0,
        },
        Number.isFinite(limit) ? limit : 200,
      ),
    );
  });
}
