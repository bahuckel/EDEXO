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
 * Worked out with the ship as it is now (cargo, refit), in tonnes, each jump at the drive's most fuel per jump.
 */
import { jumpsFrom, rangeAt, type NeutronShip } from "./neutronRoute.js";
import type { LiveHop } from "./neutronLive.js";
import type { RefuelWindowDTO } from "../shared/dto/neutron.js";

export interface FuelWindowShip extends Pick<NeutronShip, "rangeLy" | "rangeByFuel"> {
  boost: number;
  fuelPerJumpT: number;
  tankT: number;
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
  const stretch: { d: number; jumps: number; boosted: boolean; needT: number }[] = [];
  for (let k = at + 1; k < hops.length; k++) {
    const h = hops[k]!;
    const last = h.refuel || h.scoopOnWay || k === hops.length - 1;
    stretch.push({
      d: dist(hops[k - 1]!, h),
      jumps: h.jumps,
      boosted: h.boosted > 0,
      // Scooping on the way: the supercharge and the jump to a scoopable star come out of the tank, the rest after.
      needT: (h.scoopOnWay ? h.boosted + 1 : h.jumps + (last ? 0 : 1)) * per,
    });
    if (last) break;
  }
  if (!stretch.length) return null;
  const fits = (fuelT: number): boolean => {
    let left = fuelT;
    for (const s of stretch) {
      if (left + 1e-6 < s.needT) return false;
      const r = rangeAt(ship, left, tank);
      if (jumpsFrom(s.boosted, s.d, r, ship.boost).jumps > s.jumps) return false;
      left -= s.jumps * per;
    }
    return true;
  };
  let minT = 0;
  let used = 0;
  for (const s of stretch) {
    minT = Math.max(minT, used + s.needT);
    used += s.jumps * per;
  }
  if (minT > tank + 1e-6 || !fits(minT)) return null;
  let maxT = minT;
  for (let f = tank; f > minT; f -= STEP_T)
    if (fits(f)) {
      maxT = f;
      break;
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
