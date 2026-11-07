/**
 * The shipped point catalogues, loaded once — INCLUDE-BODY-IDS Phase 7.
 *
 * `data/exomastery/spatial-catalogue.json` holds 346 nebula centres (real + procgen; planetary
 * excluded on evidence) and 362 Guardian sites, plus Sgr A*. It is 50 kB and read at most once per
 * process, the same arrangement as `species-prevalence.json`.
 *
 * A missing file is not an error. The gates then return null everywhere, which reads as "we cannot
 * check" rather than "the species cannot be here" — the distinction the whole project keeps having to
 * defend, and the only safe failure mode for a file that a build might not have produced.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { SpatialCatalogue } from "../shared/spatialGates.js";
import { ALIEN_SITES } from "../shared/alienSites.js";

/** The Guardian gate's points: the catalogue's and EDSM's named Guardian systems (plan 1.3.6). */
function withGuardianSites(cat: SpatialCatalogue): SpatialCatalogue {
  const named = ALIEN_SITES.filter((r) => r[0] === "guardian").map(([, n, x, y, z]) => ({ n, x, y, z }));
  return { ...cat, guardianSites: [...cat.guardian, ...named] };
}

let cached: SpatialCatalogue | null | undefined;

/** Drop the memo ("Refresh exomastery", speciesCacheReload.ts). */
export function clearSpatialCatalogueCache(): void {
  cached = undefined;
}

export function spatialCataloguePath(projectRoot: string): string {
  return path.join(projectRoot, "data", "exomastery", "spatial-catalogue.json");
}

export function loadSpatialCatalogue(projectRoot: string): SpatialCatalogue | null {
  if (cached !== undefined) return cached;
  const file = spatialCataloguePath(projectRoot);
  if (!existsSync(file)) {
    cached = null;
    return cached;
  }
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as SpatialCatalogue;
    cached = Array.isArray(parsed?.nebulae) && Array.isArray(parsed?.guardian) ? withGuardianSites(parsed) : null;
  } catch {
    cached = null;
  }
  return cached;
}
