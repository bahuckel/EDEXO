/*
  The map's point cloud and its Bodies filters: /api/galaxy/points, /traits, /filter (split out of galaxyRoutes.ts,
  plan 2026-11-10 Phase 7.2; registered from it in the same order).
*/
import type express from "express";
import type { SpeciesDatabase } from "../../shared/types.js";
import { getCachedSpeciesDatabase } from "../snapshot.js";
import { galaxyPointsAsync } from "../galaxyPoints.js";
import { loadBioIndexAsync } from "../bioIndex.js";
import { galaxyFilterMask, loadSystemTraits, systemTraitCounts } from "../galaxyTraits.js";
import { BODY_TRAIT_GROUP, BODY_TRAITS, STAR_CLASSES } from "../../shared/galaxyTraits.js";
import { noIndex, sendBinary } from "./galaxyHttp.js";

/** Species id → genus folder, once per species tree (a reload makes a new one) instead of per filter request (D9). */
const genusDirs = new WeakMap<SpeciesDatabase, Map<string, string>>();
function genusDirById(db: SpeciesDatabase): Map<string, string> {
  let m = genusDirs.get(db);
  if (!m) genusDirs.set(db, (m = new Map(db.species.map((e) => [e.id, e.genusDataDir]))));
  return m;
}

export function registerGalaxyDataRoutes(app: express.Express): void {
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
    const genusOf = genusDirById(getCachedSpeciesDatabase());
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
}
