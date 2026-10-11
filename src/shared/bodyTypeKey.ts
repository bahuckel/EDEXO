/**
 * What kind of body is this? One definition, used by the builder and the reader.
 *
 * `scripts/build-body-type-prior.ts` writes the table and `server/bodyTypePrior.ts` looks bodies up
 * in it, and the two must agree to the character or **every lookup misses and the prior silently
 * does nothing**. That is not hypothetical: three of the model's categorical terms spent months
 * comparing the journal's spelling against the corpus's and never once matching, because the two
 * sides folded their values in different places (§C1j). The fix there was to give both sides one
 * function; this file is that function, written before the same mistake could be made twice.
 *
 * The two sources still spell things differently and always will — EDSM writes `High metal content
 * world` where the journal writes `High metal content body`, `Thin Carbon dioxide` where the journal
 * writes `CarbonDioxide` — so every part squashes to letters and digits and drops the noun or suffix
 * only one side uses.
 */
import { reportsVolcanism } from "./volcanismText.js";
import { foldSpelling } from "./spelling.js";
import { planetClassId } from "./normalise/planetClass.js";

/**
 * Temperature band edges, in kelvin.
 *
 * Measured, not chosen. The corpus is not spread across temperature — **72.8 % of bodies sit between
 * 150 K and 200 K** and another 16.6 % between 400 K and 450 K — so the obvious `[100, 200, 300]` put
 * three quarters of everything in one cell and the term said nothing on most bodies. Seven band sets
 * were swept in §C1g; this one splits the big spike and took the best top-3 and calibration.
 *
 * 300 stays an edge because it is where Bacterium tela's presence rule turns over, and 100 because
 * the cold tail is a different world from the 150-200 K bulk.
 */
export const BODY_TYPE_T_EDGES = [100, 160, 185, 300];

/** Letters and digits only, lower case: the common ground between two spellings of one fact. */
function squash(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/**
 * `High metal content world` and `High metal content body` are the same rock.
 *
 * Gas giants first (code review B7, 2026-10-11): "Gas giant with ammonia-based life" contains
 * "ammonia" and was counted with the ammonia worlds.
 */
export function bodyTypePlanetClass(subType: string | null | undefined): string {
  const t = (subType ?? "").toLowerCase();
  // Every spelling of a giant to one id ("Sudarsky class I gas giant" and "Class I gas giant"; plan 1.1
  // audit, 2026-10-11). No giant carries surface biology, so no table cell depends on it.
  if (t.includes("gas giant") || t.includes("water giant")) return planetClassId(subType) ?? (squash(t).slice(0, 14) || "?");
  if (t.includes("rocky ice")) return "rockyice";
  if (t.includes("high metal")) return "hmc";
  if (t.includes("metal rich") || t.includes("metal-rich")) return "metalrich";
  if (t.startsWith("icy")) return "icy";
  if (t.startsWith("rocky")) return "rocky";
  if (t.includes("water world")) return "water";
  if (t.includes("earth")) return "earthlike";
  if (t.includes("ammonia")) return "ammoniaworld";
  return squash(t).slice(0, 14) || "?";
}

/**
 * The gas, without the pressure word or the `rich` suffix.
 *
 * Pressure is measured separately and far better as a number, and `-rich` on one side is `Rich`
 * glued on the other — the same fold `bucketCategoricalValue` makes for the likelihood terms.
 */
export function bodyTypeAtmosphere(atmosphereType: string | null | undefined): string {
  // Any run of density words (the dump writes "Hot Water" as well as "Hot thin Water"), and the American
  // spelling folded (plan 1.1 audit, 2026-10-11: docs/perf/atmo-key-audit.mts).
  const raw = foldSpelling(atmosphereType ?? "").toLowerCase().replace(/^((hot|thin|thick)\s+)+/, "");
  const key = squash(raw.replace(/\s+atmosphere$/, "")).replace(/rich$/, "");
  // One token for an airless body (code review B6, 2026-10-11): the journal writes "None", Spansh and
  // EDSM "No atmosphere", which folded to "no" and split every airless cell of the prior in two.
  return !key || key === "no" || key === "none" ? "none" : key;
}

/**
 * The volcanism family, without its intensity.
 *
 * `Major Water Magma` and `minor water magma volcanism` are one mechanism, and an empty string is
 * what the journal writes for a quiet body — which belongs on `none` with `No volcanism`, not in a
 * bucket of its own.
 */
export function bodyTypeVolcanism(volcanismType: string | null | undefined): string {
  const t = (volcanismType ?? "").trim().toLowerCase();
  if (!reportsVolcanism(t)) return "none";
  const stripped = t.replace(/^(minor|major)\s+/, "").replace(/\s*volcanism\s*$/, "");
  const s = squash(stripped);
  return !s || s === "no" || s === "none" ? "none" : s;
}

/** Which band, as a letter. `?` when the body carries no reading. */
export function bodyTypeTemperature(
  temperatureK: number | null | undefined,
  edges: readonly number[] = BODY_TYPE_T_EDGES,
): string {
  if (typeof temperatureK !== "number" || !Number.isFinite(temperatureK)) return "?";
  let i = 0;
  while (i < edges.length && temperatureK >= edges[i]!) i++;
  return String.fromCharCode(97 + i);
}

export interface BodyTypeSource {
  subType: string | null | undefined;
  atmosphereType: string | null | undefined;
  volcanismType: string | null | undefined;
  temperatureK: number | null | undefined;
}

/** Every part of the key at once, so a caller cannot use three of the four by accident. */
export function bodyTypeKeyParts(
  src: BodyTypeSource,
  edges: readonly number[] = BODY_TYPE_T_EDGES,
): { planetClass: string; atmosphere: string; volcanism: string; temperature: string } {
  return {
    planetClass: bodyTypePlanetClass(src.subType),
    atmosphere: bodyTypeAtmosphere(src.atmosphereType),
    volcanism: bodyTypeVolcanism(src.volcanismType),
    temperature: bodyTypeTemperature(src.temperatureK, edges),
  };
}
