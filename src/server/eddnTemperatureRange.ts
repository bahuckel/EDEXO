/**
 * How far out of its codex temperature band the EDDN year has seen a species (plan-15102026-1.2.18 Part 2, owner
 * 2026-10-15: observations may not reopen a real wall).
 *
 * The matcher lets a profile observation overrule a codex temperature edge (Fungoida stabitis: codex 180-195 K, found
 * above 424 K). Some observations behind those rescues are mis-attributed Spansh / codex bodies: Stratum paleas's codex
 * floor is 165 K and its Spansh-built profile, reaching 158 K, rescued it below the floor — the EDDN year, where each
 * species is logged on the exact body, has none of its 17,590 bodies under 165.0 K, and the same bodies' Spansh and
 * journal temperatures are identical. So a rescue now reaches only as far as the EDDN year has seen the species
 * (`data/exomastery/eddn-temperature-range.json`, `docs/perf/build_eddn_temperature_range.py`). A species the table
 * does not list keeps the rescue as before.
 *
 * One lone outlier never sets the range (owner, 2026-10-15): a body beyond a codex edge counts only once two or more
 * systems show it and the pattern was examined; the rest stay in `data/exomastery/outlier-register.json`. The
 * atmosphere-linked band has its own range, so renibus growing hot elsewhere does not stretch its carbon dioxide cap.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { getProjectRoot } from "./paths.js";

export interface EddnTemperatureRange {
  minK: number;
  maxK: number;
  bodies: number;
  /** The same over the bodies whose atmosphere the species' linked band names, when it has one. */
  linkedMinK?: number;
  linkedMaxK?: number;
  linkedBodies?: number;
}

let cache: { root: string; bySpecies: Map<string, EddnTemperatureRange> } | null = null;
let rootOverride: string | null = null;

export function setEddnTemperatureRangeRootForTests(root: string | null): void {
  rootOverride = root;
  cache = null;
}

export function clearEddnTemperatureRangeCache(): void {
  cache = null;
}

export function eddnTemperatureRange(speciesId: string, root?: string): EddnTemperatureRange | null {
  const r = root ?? rootOverride ?? getProjectRoot();
  if (cache?.root !== r) {
    const bySpecies = new Map<string, EddnTemperatureRange>();
    try {
      const p = path.join(r, "data", "exomastery", "eddn-temperature-range.json");
      if (existsSync(p)) {
        const j = JSON.parse(readFileSync(p, "utf8")) as {
          species?: Record<string, Partial<EddnTemperatureRange>>;
        };
        for (const [id, v] of Object.entries(j.species ?? {})) {
          if (typeof v.minK === "number" && typeof v.maxK === "number" && typeof v.bodies === "number") {
            const r: EddnTemperatureRange = { minK: v.minK, maxK: v.maxK, bodies: v.bodies };
            if (typeof v.linkedMinK === "number" && typeof v.linkedMaxK === "number") {
              r.linkedMinK = v.linkedMinK;
              r.linkedMaxK = v.linkedMaxK;
              r.linkedBodies = typeof v.linkedBodies === "number" ? v.linkedBodies : v.bodies;
            }
            bySpecies.set(id, r);
          }
        }
      }
    } catch {
      /* no table: every rescue stands */
    }
    cache = { root: r, bySpecies };
  }
  return cache.bySpecies.get(speciesId) ?? null;
}

/**
 * Has the EDDN year seen the species at least this far beyond the edge the body is on? True when the table does not
 * know the species (or, for the linked band, has no linked range), or the body is not beyond an edge. Half a kelvin
 * of slack for rounding. The range returned is the band's own, for the reason text.
 */
export function eddnSeenThisFarOut(
  speciesId: string,
  kelvin: number,
  lo: number | undefined,
  hi: number | undefined,
  band: "flat" | "linked" = "flat",
): { seen: boolean; range: EddnTemperatureRange | null } {
  const all = eddnTemperatureRange(speciesId);
  const range =
    all && band === "linked"
      ? all.linkedMinK !== undefined && all.linkedMaxK !== undefined
        ? { minK: all.linkedMinK, maxK: all.linkedMaxK, bodies: all.linkedBodies ?? all.bodies }
        : null
      : all;
  if (!range || !Number.isFinite(kelvin)) return { seen: true, range };
  if (lo !== undefined && kelvin < lo) return { seen: range.minK <= kelvin + 0.5, range };
  if (hi !== undefined && kelvin > hi) return { seen: range.maxK >= kelvin - 0.5, range };
  return { seen: true, range };
}
