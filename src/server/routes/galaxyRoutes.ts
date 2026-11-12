/*
  The galaxy map's server side: its extra layers, which caches its memory clock lets go, the middleware that reads the
  tile index and traits off the main thread, then each part's routes (split by sub-path, plan 2026-11-10 Phase 7.2).
*/
import type express from "express";
import { clearGalaxyPoints } from "../galaxyPoints.js";
import { clearTileIndex, tileIndexAsync } from "../galaxyTiles.js";
import { registerGalaxyCache, touchGalaxyMemory } from "../galaxyMemory.js";
import { clearBioBodiesCache } from "../bioBodies.js";
import { clearBioIndexCache } from "../bioIndex.js";
import { clearGalaxyCatalogueCache, clearGalaxySystemValues } from "../galaxyValueSearch.js";
import { clearSystemTraits, loadSystemTraitsAsync } from "../galaxyTraits.js";
import type { HttpServerOptions, RouteContext } from "../httpServerTypes.js";
import { galaxyLayer, type GalaxyLayerKind } from "../galaxyLayers.js";
import { GALAXY_LAYER_KINDS } from "../../shared/galaxyLayers.js";
import { clearBarrenTable } from "../boxelBarren.js";
import { clearStationsIndex } from "../stationsIndex.js";
import { clearNeutronIndex } from "../neutronIndex.js";
import { clearJumponiumIndex } from "../jumponiumIndex.js";
import { registerGalaxyDataRoutes } from "./galaxyDataRoutes.js";
import { registerGalaxyIndexRoutes } from "./galaxyIndexRoutes.js";
import { registerNavRouteRoutes } from "./navRouteRoutes.js";
import { registerGalaxyMapRoutes } from "./galaxyMapRoutes.js";
import { registerGalaxyMineRoutes } from "./galaxyMineRoutes.js";
import { registerGalaxySearchRoutes } from "./galaxySearchRoutes.js";

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
    JOURNAL_ONLY); two idle minutes let it go (galaxyMemory.ts — the map is its own window, loaded
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

  registerGalaxyDataRoutes(app);
  registerGalaxyIndexRoutes(app, opts);
  registerNavRouteRoutes(app, opts);
  registerGalaxyMapRoutes(app, opts);
  registerGalaxyMineRoutes(app, opts, ctx);
  registerGalaxySearchRoutes(app, opts);
}
