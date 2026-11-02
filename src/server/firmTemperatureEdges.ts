/**
 * Temperature edges a species has never been found past (`data/exomastery/firm-temperature-edges.json`, built by
 * docs/perf/calibration/firm_edges_scan.py from the EDDN year).
 *
 * Unlike the observed-temperature envelope (observedEnvelope.ts), these are walls, not tails: a round number, a pile
 * of bodies right at it, and none past it in a year of finds. Concha labiata starts at 150.0 K on 27,415 bodies and
 * no colder; Stratum paleas at 165.0 K on 46,040. The app still listed them a little past the edge (the envelope's
 * 0.5 K tolerance, and the signal-count rescue taking temperature rows back first): 462 rows on 60,000 sample bodies,
 * none of them there (overnight study, 2026-11-02).
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { getProjectRoot } from "./paths.js";

export interface FirmTemperatureEdge {
  minK?: number;
  maxK?: number;
  /** The species' bodies in the EDDN year: how much stands behind the edge. */
  bodies: number;
}

let cache: Map<string, FirmTemperatureEdge> | null = null;

/** The species' firm edges, or undefined when it has none. */
export function firmTemperatureEdge(speciesId: string): FirmTemperatureEdge | undefined {
  if (!cache) {
    cache = new Map();
    const file = path.join(getProjectRoot(), "data", "exomastery", "firm-temperature-edges.json");
    try {
      if (existsSync(file)) {
        const doc = JSON.parse(readFileSync(file, "utf8")) as { species?: Record<string, Partial<FirmTemperatureEdge>> };
        for (const [id, v] of Object.entries(doc.species ?? {})) {
          const minK = typeof v.minK === "number" && Number.isFinite(v.minK) ? v.minK : undefined;
          const maxK = typeof v.maxK === "number" && Number.isFinite(v.maxK) ? v.maxK : undefined;
          if (minK === undefined && maxK === undefined) continue;
          cache.set(id, { minK, maxK, bodies: typeof v.bodies === "number" ? v.bodies : 0 });
        }
      }
    } catch {
      /* no file: no firm edges, the envelope alone judges */
    }
  }
  return cache.get(speciesId);
}

export function clearFirmTemperatureEdgesCache(): void {
  cache = null;
}

/** Which edge a measured temperature lies past, if any. */
export function pastFirmEdge(edge: FirmTemperatureEdge, tempK: number): { side: "below" | "above"; edgeK: number } | null {
  if (edge.minK !== undefined && tempK < edge.minK) return { side: "below", edgeK: edge.minK };
  if (edge.maxK !== undefined && tempK > edge.maxK) return { side: "above", edgeK: edge.maxK };
  return null;
}
