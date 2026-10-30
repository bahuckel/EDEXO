/**
 * How much to scoop at a refuel stop of the neutron route being flown (owner, 2026-10-29: "how much he needs to refuel
 * for partial runs … like a green area that will take him to the next refuel, and also make the rest of the jumps
 * possible").
 *
 * The stretch from this stop to the next refuel (or a "scoop on the way", or the route's end) sets both ends:
 * - at least: the fuel for its jumps, every hop arriving with one jump's fuel to spare and the last with none (the
 *   planner's own rule, neutronRoute.ts `afterHop`);
 * - at most: the heaviest tank on which every hop still makes its planned jumps. A fuller tank is a heavier ship and a
 *   shorter supercharge, so past this a hop needs a jump more than planned, or its supercharge falls short.
 * Worked out with the ship as it is now (cargo, refit), in tonnes, each jump at the drive's most fuel per jump; with the
 * drive's own law (`law`, fsdDrives.ts) a supercharge spends what its distance takes at the mass aboard, and the range
 * is the drive's at that tank. The normal jumps after a supercharge stay at the most per jump: the game's plot picks
 * their stars.
 */
import { jumpsFrom, rangeAt, type NeutronShip } from "./neutronRoute.js";
import type { LiveHop } from "./neutronLive.js";
import type { RefuelWindowDTO } from "../shared/dto/neutron.js";

export interface FuelWindowShip extends Pick<NeutronShip, "rangeLy" | "rangeByFuel"> {
  boost: number;
  fuelPerJumpT: number;
  tankT: number;
  /** The drive's own law with the ship's cargo: fuel (t) for an unboosted jump, longest jump (ly), by the tank aboard. */
  law?: { fuelT: (ly: number, tankT: number) => number; rangeLy: (tankT: number) => number } | null;
}

/** The tank is tried this finely (t) for the most it may hold. */
const STEP_T = 0.5;

const dist = (a: LiveHop, b: LiveHop) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/** The window at `hops[at]` when it is a refuel stop; null otherwise, or when no tank makes the stretch. */
export function refuelWindow(
  hops: readonly LiveHop[],
  at: number,
  ship: FuelWindowShip,
  fuelNowT: number | null,
): RefuelWindowDTO | null {
  const per = ship.fuelPerJumpT;
  const tank = ship.tankT;
  if (!hops[at]?.refuel || !(per > 0) || !(tank > 0)) return null;
  const law = ship.law ?? null;
  const range = (fuelT: number) => (law ? law.rangeLy(fuelT) : rangeAt(ship, fuelT, tank));
  const stretch: { d: number; jumps: number; boosted: boolean; scoopOnWay: boolean; last: boolean }[] = [];
  for (let k = at + 1; k < hops.length; k++) {
    const h = hops[k]!;
    const last = h.refuel || h.scoopOnWay || k === hops.length - 1;
    stretch.push({ d: dist(hops[k - 1]!, h), jumps: h.jumps, boosted: h.boosted > 0, scoopOnWay: h.scoopOnWay, last });
    if (last) break;
  }
  if (!stretch.length) return null;
  /*
    A hop's fuel with `left` aboard: what it burns, and what it needs aboard at its start (a jump to spare on arrival,
    none on the last; scooping on the way, the supercharge and the jump to a scoopable star, the rest after). Its
    supercharge by the law when known: the distance it covers, at most the supercharge's reach.
  */
  const hopFuel = (s: (typeof stretch)[number], left: number) => {
    let first = per;
    if (law && s.boosted) {
      // Its reach with a jump's fuel aboard: on less the range check below says it falls short.
      const reach = ship.boost * range(Math.max(left, per));
      first = Math.min(per, law.fuelT(Math.min(s.d, reach) / ship.boost, left));
    }
    const burnT = first + (s.jumps - 1) * per;
    const needT = s.scoopOnWay ? first + (s.boosted ? per : 0) : burnT + (s.last ? 0 : per);
    return { burnT, needT };
  };
  const run = (fuelT: number, checkRange: boolean): boolean => {
    let left = fuelT;
    for (const s of stretch) {
      const f = hopFuel(s, left);
      // The search for the least fuel goes exact; the check keeps a hair of slack for rounding.
      if (left + (checkRange ? 1e-6 : 0) < f.needT) return false;
      // A hair of slack: at the least fuel the supercharge's reach is the hop, to the last bit.
      if (checkRange && jumpsFrom(s.boosted, s.d, range(left) + 1e-6, ship.boost).jumps > s.jumps) return false;
      left -= f.burnT;
    }
    return true;
  };
  const fits = (fuelT: number) => run(fuelT, true);
  // The least fuel that covers every hop's need: a lighter tank burns less, so search it rather than add it up.
  let lo = 0;
  let hi = tank;
  if (!run(hi, false)) return null;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (run(mid, false)) hi = mid;
    else lo = mid;
  }
  const minT = hi;
  if (minT > tank + 1e-6 || !fits(minT)) return null;
  let maxT = minT;
  for (let f = tank; f > minT; f -= STEP_T)
    if (fits(f)) {
      maxT = f;
      break;
    }
  // Then to the hundredth of a tonne between that step and the next, which did not fit.
  if (maxT < tank) {
    let bad = Math.min(tank, maxT + STEP_T);
    for (let i = 0; i < 12; i++) {
      const mid = (maxT + bad) / 2;
      if (fits(mid)) maxT = mid;
      else bad = mid;
    }
  }
  const r1 = (v: number) => Math.round(v * 10) / 10;
  // The ends round inwards, so "enough" at the bottom and the top of the green really are.
  const up = (v: number) => Math.ceil(v * 10 - 1e-6) / 10;
  const down = (v: number) => Math.floor(v * 10 + 1e-6) / 10;
  return {
    minT: up(minT),
    maxT: Math.max(up(minT), down(maxT)),
    tankT: r1(tank),
    nowT: fuelNowT != null && Number.isFinite(fuelNowT) ? r1(fuelNowT) : null,
    toStop: stretch.length,
  };
}
