/**
 * What a discovered system on the route is worth (plan 1.3.3 R-1 / R-3, owner 2026-10-30): its bodies from Spansh,
 * valued the way the app values the system the ship is in. Values at 1×: other commanders reported the system, so
 * no first-discovery, first-mapped or first-footfall bonus.
 */
export interface RouteSystemBodyDTO {
  name: string;
  /** The Notable card's tag ("Earth-like", "HMC - Terraformable"), or null for a bio-only body. */
  tag: string | null;
  fssCr: number;
  /** Mapped value (DSS), for a planet. */
  dssCr: number | null;
  /** Biological signals, and the expected exobiology value at 1× (Σ chance × price). */
  bioSignals: number | null;
  bioCr: number | null;
  /** The likeliest species, best first: logged by others, or predicted. */
  species: { name: string; cr: number | null; chancePct: number | null; logged: boolean }[];
}

export interface RouteSystemValuesDTO {
  addr: string;
  name: string;
  /** `none`: Spansh has no bodies for it (undiscovered, or never reported). */
  state: "ok" | "none" | "error";
  /** Where the bodies come from: his journals (own scans, then EDSM) or Spansh (absent: Spansh). */
  source?: "journal" | "spansh";
  error?: string;
  bodyCount: number;
  /** The honk's count (Spansh `bodyCount`), when somebody reported it; and how many of those nobody scanned. */
  bodyTotal: number | null;
  missing: number;
  /** Every body scanned with the FSS, the honk included. */
  fssCr: number;
  /** The worthwhile planets (the notable ones) mapped: their mapped value, in place of their scan. */
  dssCr: number;
  dssBodies: number;
  /** FSS of everything plus the worthwhile planets mapped: what the system pays. */
  totalCr: number;
  /** Expected exobiology at 1×, all bodies. */
  bioCr: number;
  /** Notable planets and bodies with biology, most valuable first. */
  bodies: RouteSystemBodyDTO[];
  fetchedAt: string | null;
}

/** One body of the scan view (plan 1.3.3 R-4). Positions in light-seconds from the system's root, at `atMs`. */
export interface ScanRouteBodyDTO {
  /** Journal BodyID. */
  id: number;
  name: string;
  /** The name without the system's ("AB 1 c"). */
  short: string;
  kind: "star" | "planet";
  /** Star type ("K", "DA", "N") or planet class ("Icy body"). */
  cls: string | null;
  /** The Notable card's tag, if any. */
  tag: string | null;
  pos: { x: number; y: number; z: number };
  /** Where the view draws it: seen from above, each orbit's length on a log scale (orbitPositions.ts). */
  viewPos: { x: number; y: number; z: number };
  /** The view's place of what it orbits (a barycentre too): the centre of its ring; null for the root. */
  ringCentre: { x: number; y: number; z: number } | null;
  /** The true place of what it orbits (ls), for the true-scale view's ring; null for the root. */
  parentPos: { x: number; y: number; z: number } | null;
  /** The body it orbits (journal id; a barycentre's Null id), and that orbit's size (ls): for the view's rings. */
  parentId: number | null;
  /** A planet somewhere up its Parents chain: a moon (drawn smaller, named only on the route). */
  moon: boolean;
  orbitLs: number | null;
  radiusKm: number | null;
  fssCr: number;
  /** Mapped value (planets), at the rate this commander would get. */
  dssCr: number | null;
  mapped: boolean;
  bioSignals: number | null;
  /** Expected exobiology (Σ chance × price × the footfall multiplier this commander would get). */
  bioCr: number | null;
  /** In the route: DSS value at least the minimum, or biology left to sample. */
  target: "dss" | "bio" | "both" | null;
}

export interface ScanRouteDTO {
  addr: string;
  name: string;
  /** Where the bodies come from: the commander's journals (own scans, then EDSM), or Spansh. */
  source: "journal" | "spansh";
  state: "ok" | "none" | "error";
  error?: string;
  atMs: number;
  minDssCr: number;
  /** The arrival star: where the route starts. */
  startId: number | null;
  bodies: ScanRouteBodyDTO[];
  /** Body ids in the order to fly them, and the whole way (ls). */
  route: { order: number[]; totalLs: number };
  /** Bodies known here, the honk's count when known, and the difference. */
  bodyCount: { known: number; total: number | null; missing: number };
  /** The route's values: mapping the DSS targets, sampling the bio ones. */
  routeDssCr: number;
  routeBioCr: number;
}
