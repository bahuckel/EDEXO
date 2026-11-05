/**
 * Where a boxel's systems are, for the shortest order (shared/boxelOrder.ts): every route he plotted (NavRoute.json
 * gives each system's StarPos, the destination too; server/navRouteLog.ts keeps them), then Spansh's look-up of the
 * boxel (server/boxelLookup.ts). A galaxy-map target gives none: FSDTarget and Status.json carry a name and an address
 * only (owner's test, 2026-11-04), and the address places a g system no closer than its 640 ly cube.
 */
import { boxelIndexOf } from "../shared/boxel.js";
import type { Vec3 } from "../shared/boxelOrder.js";
import type { BoxelLookupRecord } from "./boxelLookup.js";
import { navRouteLog } from "./navRouteLog.js";

/** The look-ups kept by the Boxels routes (routes/boxelRoutes.ts); null until they are set up. */
let lookupOf: ((prefix: string) => BoxelLookupRecord | null) | null = null;

export function setBoxelLookupSource(get: ((prefix: string) => BoxelLookupRecord | null) | null): void {
  lookupOf = get;
}

/** System number → position, for the boxel `prefix` ("Eembaids EG-Y g"). The plotted routes win over Spansh. */
export function boxelPositions(prefix: string): Map<number, Vec3> {
  const out = new Map<number, Vec3>();
  for (const s of navRouteLog().systems) {
    const n = boxelIndexOf(s.name, prefix);
    if (n != null && s.pos) out.set(n, s.pos);
  }
  for (const [k, f] of Object.entries(lookupOf?.(prefix)?.systems ?? {})) {
    const n = Number(k);
    if (f.pos && Number.isInteger(n) && !out.has(n)) out.set(n, f.pos);
  }
  return out;
}
