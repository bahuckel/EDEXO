/**
 * Elite Dangerous `NavRoute.json` (next to journal): plotted route waypoints with `StarPos` in ly.
 * Fuel along the route is the drive's own law, fitted on the commander's jumps (shared/fsdFuel.ts:
 * fuel = k · (distance · mass)^p, the ship lighter after every jump, a leg never more than the drive's most fuel
 * per jump); the legs' range is the game's own plotter's business. Without the fit (no ship mass yet) the last `FSDJump` is scaled
 * by distance², the old rule, which comes up short on a leg longer than the sample (2026-10-08).
 */

import { fuelForJump, type FsdFuelModel } from "../shared/fsdFuel.js";
import { roleForStarType, type StarRolesConfig } from "./systemMap.js";

export interface NavRouteWaypointDTO {
  systemAddress: number;
  starSystem: string;
  starPos: [number, number, number];
  /** NavRoute `StarClass` (spectral letter, e.g. G, M) — used for scoopable detection. */
  starClass?: string;
}

export function distanceLy3d(a: [number, number, number], b: [number, number, number]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const dz = b[2] - a[2];
  return Math.hypot(dx, dy, dz);
}

function normalizedSystemName(name: string | null | undefined): string | null {
  const t = name?.trim();
  return t ? t.toLowerCase() : null;
}

export function parseNavRouteJson(raw: string): NavRouteWaypointDTO[] | null {
  const t = raw.trim();
  if (!t) return null;
  let o: unknown;
  try {
    o = JSON.parse(t) as unknown;
  } catch {
    return null;
  }
  if (!o || typeof o !== "object") return null;
  const route = (o as Record<string, unknown>).Route;
  if (!Array.isArray(route) || route.length < 2) return null;
  const out: NavRouteWaypointDTO[] = [];
  for (const row of route) {
    if (!row || typeof row !== "object") return null;
    const rec = row as Record<string, unknown>;
    const addr = rec.SystemAddress;
    const nameRaw = rec.StarSystem;
    const pos = rec.StarPos;
    if (typeof addr !== "number" || !Number.isFinite(addr)) return null;
    if (typeof nameRaw !== "string" || !nameRaw.trim()) return null;
    if (!Array.isArray(pos) || pos.length < 3) return null;
    const x = pos[0];
    const y = pos[1];
    const z = pos[2];
    if (typeof x !== "number" || typeof y !== "number" || typeof z !== "number") return null;
    if (![x, y, z].every((n) => Number.isFinite(n))) return null;
    const starClassRaw = rec.StarClass;
    const starClass =
      typeof starClassRaw === "string" && starClassRaw.trim() ? starClassRaw.trim() : undefined;
    const wp: NavRouteWaypointDTO = {
      systemAddress: addr,
      starSystem: nameRaw.trim(),
      starPos: [x, y, z],
    };
    if (starClass) wp.starClass = starClass;
    out.push(wp);
  }
  return out.length >= 2 ? out : null;
}

export type RouteRefuelAlertDTO = "none" | "yellow" | "red";

/** How many hops the HUD's route strip carries; the page fills its row and clips the rest. */
export const ROUTE_AHEAD_HOPS = 40;

export interface RouteAheadHop {
  starSystem: string;
  starClass: string;
  scoopable: boolean;
  refuel: RouteRefuelAlertDTO;
  /** See `RouteAheadHopDTO.likelyFirstFootfall`. Null when the lookup has not answered. */
  likelyFirstFootfall: boolean | null;
  /** See `RouteAheadHopDTO.firstFootfallNote`. */
  firstFootfallNote?: string | null;
}

export interface NavRouteFuelAnalysis {
  onPlot: boolean;
  routeTotalLy: number;
  routeRemainingLy: number | null;
  routeJumpsRemaining: number | null;
  fuelCanFinishPlottedRoute: boolean | null;
  fuelJumpsReachableOnPlottedRoute: number | null;
  maxRemainingLegLy: number | null;
  anyRemainingLegOverMaxRange: boolean;
  /**
   * Fuel / scoop heuristic: red = refuel now or critical; yellow = refuel next hop or ~2 jumps of fuel left.
   * Only set when `fuelCanFinishPlottedRoute === false` (needs scoop or station somewhere).
   */
  routeRefuelAlert: RouteRefuelAlertDTO;
  /**
   * Jumps until the furthest main-sequence scoopable you can **reach on the current tank** along
   * NavRoute.json (per-leg ly from StarPos, fuel by the drive's law). Same star-class rules as refuel alerts. When
   * tank or FSD sample is missing, falls back to hop count to the **last** scoop on the remaining plot. `null` when
   * no scoop ahead or none reachable.
   */
  jumpsToLastScoopableOnRoute: number | null;
  /** See `LiveShipFuelNavRouteDTO.ahead`. */
  ahead: RouteAheadHop[];
  refuelInHops: number | null;
  refuelLevel: RouteRefuelAlertDTO;
}

const FUEL_MARGIN_T = 0.06;
/** Avoid blow-ups when the last jump was a trivial in-system hop. */
const MIN_SAMPLE_DIST_LY = 0.08;
const FUEL_SUM_EPS = 1e-6;

/**
 * Highest scoop index k in [idx, lastScoopIdx] reachable from idx without refuelling: cumulative fuel ≤ budget
 * (when an estimator is given). Range is not checked: the game plotted these legs (see analyzeNavRouteFuel).
 */
function furthestReachableScoopIndex(params: {
  idx: number;
  lastScoopIdx: number;
  scoop: boolean[];
  legLy: number[];
  budget: number | null;
  /** Fuel for a leg, with the tank before it (the ship is lighter on later legs). */
  estFuelForLeg: ((dLy: number, tankT: number) => number) | null;
  tankT: number | null;
}): number | null {
  const { idx, lastScoopIdx, scoop, legLy, budget, estFuelForLeg, tankT } = params;
  let best: number | null = null;

  for (let k = idx; k <= lastScoopIdx; k++) {
    if (!scoop[k]) continue;
    let fuelSum = 0;
    let ok = true;
    for (let i = idx; i < k; i++) {
      const d = legLy[i]!;
      if (budget != null && estFuelForLeg != null) {
        fuelSum += estFuelForLeg(d, (tankT ?? 0) - fuelSum);
        if (fuelSum > budget + FUEL_SUM_EPS) {
          ok = false;
          break;
        }
      }
    }
    if (ok) best = k;
  }
  return best;
}

/** Next N systems on the route starting at `idx` (for scoopable corridor checks). */
const SCOOP_LOOKAHEAD_SYSTEMS = 10;
function scoopableAtWaypoint(wp: NavRouteWaypointDTO, cfg: StarRolesConfig): boolean {
  return roleForStarType(wp.starClass, cfg) === "fuel";
}

function computeRouteRefuelAlert(params: {
  idx: number;
  scoop: boolean[];
  canFinish: boolean | null;
  jReach: number | null;
  jRem: number;
}): RouteRefuelAlertDTO {
  const { idx, scoop, canFinish, jReach, jRem } = params;
  if (jRem <= 0 || canFinish !== false) return "none";

  const lastIdx = scoop.length - 1;
  const horizonEnd = Math.min(lastIdx, idx + (SCOOP_LOOKAHEAD_SYSTEMS - 1));
  let scoopInHorizon = false;
  for (let j = idx; j <= horizonEnd; j++) {
    if (scoop[j]) {
      scoopInHorizon = true;
      break;
    }
  }

  const scoopOnlyHereInHorizon =
    scoop[idx] &&
    (() => {
      for (let j = idx + 1; j <= horizonEnd; j++) {
        if (scoop[j]) return false;
      }
      return true;
    })();

  /** No KGBFOAM-class stars in the next leg of the route — long “fuel desert”. */
  if (!scoopInHorizon) return "red";

  /** Final jump: station fuel is unknown — warn for scoop or top-up. */
  if (jRem === 1) return "red";

  /** Current star is the only scoopable in the near window — must scoop before leaving. */
  if (scoopOnlyHereInHorizon) return "red";

  const firstScoopAhead = (() => {
    for (let j = idx + 1; j <= lastIdx; j++) {
      if (scoop[j]) return j;
    }
    return null;
  })();

  if (jReach === 2) return "yellow";

  if (firstScoopAhead === idx + 1 && !scoop[idx] && jReach != null && jReach >= 1 && jReach <= 3) {
    return "yellow";
  }

  return "none";
}

export function analyzeNavRouteFuel(opts: {
  route: NavRouteWaypointDTO[] | null;
  currentSystemAddress: number | null;
  /** Fallback when `SystemAddress` from the journal and NavRoute disagree (rare edge cases). */
  currentSystemName?: string | null;
  /** `null` when `Status.json` fuel is unavailable — distance fields still computed. */
  fuelTotalT: number | null;
  lastFsdFuelT: number | null;
  lastFsdDistLy: number | null;
  loadoutMaxJumpLy: number | null;
  /** The drive's fitted fuel law (shared/fsdFuel.ts); the old distance² rule when absent. */
  fuelModel?: FsdFuelModel | null;
  /** Cargo aboard (t), part of the ship's mass. */
  cargoT?: number | null;
  /**
   * The FSD is supercharged (`JetConeBoost` since the last jump: 4 at a neutron star, 1.5 at a white dwarf; 6 for
   * the Caspian's Mk II SCO): the next jump reaches that many times as far on the fuel of an ordinary one.
   */
  firstLegBoost?: number | null;
  starRoles: StarRolesConfig;
  /**
   * Whether the commander would probably be first in a system, or null when unknown.
   *
   * Passed in rather than looked up here: this module is arithmetic over a route file and has no
   * business making network calls. See `firstFootfallLookup.ts`.
   */
  firstFootfallVerdict?: (systemName: string) => boolean | null;
  /** Why a system has no verdict yet, for the HUD tooltip. See `FirstFootfallLookup.note`. */
  firstFootfallNote?: (systemName: string) => string | null;
}): NavRouteFuelAnalysis | null {
  const {
    route,
    currentSystemAddress,
    currentSystemName,
    fuelTotalT,
    lastFsdFuelT,
    lastFsdDistLy,
    loadoutMaxJumpLy,
    starRoles,
  } = opts;
  if (!route || route.length < 2) return null;

  const legLy: number[] = [];
  for (let i = 0; i < route.length - 1; i++) {
    legLy.push(distanceLy3d(route[i]!.starPos, route[i + 1]!.starPos));
  }
  const routeTotalLy = legLy.reduce((s, d) => s + d, 0);

  let idx =
    currentSystemAddress != null ? route.findIndex((w) => w.systemAddress === currentSystemAddress) : -1;
  if (idx < 0) {
    const nn = normalizedSystemName(currentSystemName ?? null);
    if (nn) {
      idx = route.findIndex((w) => normalizedSystemName(w.starSystem) === nn);
    }
  }
  const onPlot = idx >= 0;

  const scoop = route.map((w) => scoopableAtWaypoint(w, starRoles));

  if (!onPlot) {
    return {
      onPlot: false,
      routeTotalLy,
      routeRemainingLy: null,
      routeJumpsRemaining: null,
      fuelCanFinishPlottedRoute: null,
      fuelJumpsReachableOnPlottedRoute: null,
      maxRemainingLegLy: null,
      anyRemainingLegOverMaxRange: false,
      routeRefuelAlert: "none",
      jumpsToLastScoopableOnRoute: null,
      ahead: [],
      refuelInHops: null,
      refuelLevel: "none",
    };
  }

  const routeRemainingLy = legLy.slice(idx).reduce((s, d) => s + d, 0);
  /*
    For fuel and range, a supercharged next jump counts as the ordinary jump it costs (review 1.2.16: plotting on from
    a neutron star with the FSD supercharged showed a red "!" — the first leg looked out of reach).
  */
  const boost = opts.firstLegBoost != null && opts.firstLegBoost > 1 ? opts.firstLegBoost : 1;
  const fuelLegLy = boost > 1 && idx < legLy.length ? legLy.map((d, i) => (i === idx ? d / boost : d)) : legLy;
  const remainingLegs = fuelLegLy.slice(idx);
  const routeJumpsRemaining = Math.max(0, route.length - 1 - idx);
  const maxRemainingLegLy = remainingLegs.length === 0 ? null : Math.max(...remainingLegs);
  /*
    No range rule on the plotted legs: the game's route plotter only plots jumps the ship can make, and the fuel law's
    longest jump is the weaker of the two. On the owner's history (2026-10-15) 204 of 5,649 ordinary jumps went further
    than the law's longest jump for that tank, 41 of 677 on a full tank (up to 17.5 % further): the walk stopped at a
    leg the ship then flew, and the pump blinked red on the scoop before it with the tank full (owner: "sometimes it
    shows that I need to refuel at the next jump even if fuel is full"). The fuel budget alone decides, with a leg
    never costing more than the drive's most fuel per jump.
  */

  let anyRemainingLegOverMaxRange = false;
  if (loadoutMaxJumpLy != null && loadoutMaxJumpLy > 0 && maxRemainingLegLy != null) {
    anyRemainingLegOverMaxRange = maxRemainingLegLy > loadoutMaxJumpLy + 1e-3;
  }

  let fuelCanFinishPlottedRoute: boolean | null = null;
  let fuelJumpsReachableOnPlottedRoute: number | null = null;
  let estFuelForLeg: ((dLy: number, tankT: number) => number) | null = null;
  let fuelBudget: number | null = null;
  const model = opts.fuelModel ?? null;
  const cargo = Math.max(0, opts.cargoT ?? 0);

  if (remainingLegs.length === 0) {
    fuelCanFinishPlottedRoute = true;
    fuelJumpsReachableOnPlottedRoute = 0;
  } else if (fuelTotalT != null && Number.isFinite(fuelTotalT) && fuelTotalT >= 0) {
    if (model) {
      const most = model.maxFuelPerJumpT;
      estFuelForLeg = (dLy, tankT) => {
        const f = fuelForJump(model, dLy, Math.max(0, tankT), cargo);
        return most != null ? Math.min(f, most) : f;
      };
    } else if (lastFsdFuelT != null && lastFsdFuelT > 0 && lastFsdDistLy != null && lastFsdDistLy > 0) {
      const d0 = Math.max(lastFsdDistLy, MIN_SAMPLE_DIST_LY);
      estFuelForLeg = (dLy) => lastFsdFuelT * (dLy / d0) * (dLy / d0);
    }
  }
  if (estFuelForLeg && fuelTotalT != null && remainingLegs.length > 0) {
    fuelBudget = Math.max(0, fuelTotalT - FUEL_MARGIN_T);
    // Leg by leg: each one costs what this lighter ship spends on it, and must be within reach.
    let tank = fuelTotalT;
    let spent = 0;
    let done = 0;
    let short = false;
    for (const d of remainingLegs) {
      const need = estFuelForLeg(d, tank);
      if (spent + need > fuelBudget + 1e-6) {
        short = true;
        break;
      }
      spent += need;
      tank -= need;
      done++;
    }
    fuelCanFinishPlottedRoute = !short;
    fuelJumpsReachableOnPlottedRoute = done;
  }

  const routeAlert = computeRouteRefuelAlert({
    idx,
    scoop,
    canFinish: fuelCanFinishPlottedRoute,
    jReach: fuelJumpsReachableOnPlottedRoute,
    jRem: routeJumpsRemaining,
  });

  let jumpsToLastScoopableOnRoute: number | null = null;
  let lastScoopIdx = -1;
  for (let j = idx; j < route.length; j++) {
    if (scoop[j]) lastScoopIdx = j;
  }
  if (lastScoopIdx >= idx) {
    const furthest = furthestReachableScoopIndex({
      idx,
      lastScoopIdx,
      scoop,
      legLy: fuelLegLy,
      budget: fuelBudget,
      estFuelForLeg,
      tankT: fuelTotalT,
    });
    if (furthest != null) {
      jumpsToLastScoopableOnRoute = furthest - idx;
    }
  }

  /*
    The route strip's pump (owner, 2026-10-13, after 1.2.15 showed two pumps and a red one on routes with no
    trap): one mark, only when the tank cannot finish the plot.
    - Walk the plot on the fuel aboard, no scooping: the last system the tank reaches (`lastReachIdx`).
    - It is scoopable: yellow there, the furthest star to scoop at (as in 1.2.14).
    - It is not: past the last scoopable star before it the tank runs dry with nowhere to scoop, a trap. Red,
      blinking, on that last scoopable star ("here" when it is this one), and no yellow; even one scoopable
      star and ten that are not is a trap when the tank cannot cross them.
    - No scoopable star in reach at all, this one included: red, no star ("!").
    Without a fuel estimate the last reachable system is not known: yellow on the furthest scoopable star.
  */
  let refuelIdx = -1;
  if (fuelCanFinishPlottedRoute === false && jumpsToLastScoopableOnRoute != null) {
    refuelIdx = idx + jumpsToLastScoopableOnRoute;
  }
  const lastReachIdx =
    fuelCanFinishPlottedRoute === false && fuelJumpsReachableOnPlottedRoute != null
      ? idx + fuelJumpsReachableOnPlottedRoute
      : null;
  let refuelLevel: RouteRefuelAlertDTO = "none";
  if (refuelIdx >= idx) refuelLevel = lastReachIdx != null && refuelIdx < lastReachIdx ? "red" : "yellow";
  else if (fuelCanFinishPlottedRoute === false && routeJumpsRemaining > 0) refuelLevel = "red";
  // The web UI's Route card: red only for a trap whose last chance is here (or no scoop in reach), never
  // for the old heuristics alone.
  const routeRefuelAlert: RouteRefuelAlertDTO =
    refuelLevel === "red" && refuelIdx <= idx ? "red" : routeAlert === "red" ? "yellow" : routeAlert;
  const ahead: RouteAheadHop[] = [];
  for (let j = idx + 1; j < route.length && ahead.length < ROUTE_AHEAD_HOPS; j++) {
    const w = route[j]!;
    ahead.push({
      starSystem: w.starSystem,
      starClass: w.starClass ?? "",
      scoopable: scoop[j]!,
      refuel: j === refuelIdx ? refuelLevel : "none",
      likelyFirstFootfall: opts.firstFootfallVerdict?.(w.starSystem) ?? null,
      firstFootfallNote: opts.firstFootfallNote?.(w.starSystem) ?? null,
    });
  }

  return {
    onPlot: true,
    routeTotalLy,
    routeRemainingLy,
    routeJumpsRemaining,
    fuelCanFinishPlottedRoute,
    fuelJumpsReachableOnPlottedRoute,
    maxRemainingLegLy,
    anyRemainingLegOverMaxRange,
    routeRefuelAlert,
    jumpsToLastScoopableOnRoute,
    ahead,
    refuelInHops: refuelIdx >= idx ? refuelIdx - idx : null,
    refuelLevel,
  };
}
