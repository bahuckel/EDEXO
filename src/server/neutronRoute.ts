/**
 * The neutron route planner (plan 8.3, owner 2026-10-13): from A through B, C … with supercharged jumps from neutron
 * star to neutron star, refuel stops, and the FSD's wear. No code or text from other planners; the mechanic is the
 * game's: at a neutron star the FSD supercharges, and the next jump reaches four times the range.
 *
 * Model, conservative where it has to guess:
 * - From a neutron star a jump of d ly costs 1 jump when d ≤ 4R (supercharged), else 1 + ⌈(d − 4R) / R⌉ (the
 *   supercharged jump, then the game's own plot for the rest). From anywhere else ⌈d / R⌉ normal jumps.
 * - Fuel is counted in jumps: a full tank does `jumpsPerTank` of the longest jumps the drive allows (each supercharged
 *   jump burns what the longest normal jump does), and the tank has `jumpsNow` left at the start.
 * - A refuel is a neutron star whose own system has a scoopable star (42 % of them: no extra jump); the plan goes by
 *   one before the tank would run dry and says "scoop here". Normal-jump stretches are not counted as scooping
 *   chances, though the game's plot may pass scoopable stars.
 * - Each supercharge wears the FSD by `wearPerBoost`; the plan marks the jump after which it is expected under 80 %.
 *
 * Search: weighted A* over (neutron star, jumps of fuel left), with neighbours cut to the ones that make progress
 * towards the leg's end (the best 32 by distance gained); it hands the event loop back as it goes, so a plan across
 * sparse space (3 s) never stalls the app.
 */
import type { NeutronIndex, NeutronStar } from "./neutronIndex.js";
import {
  INJECTIONS,
  injectionsToSaveJump,
  jumpElement,
  type InjectionSave,
  type InjectionTier,
  type JumpElement,
} from "../shared/jumponium.js";

type Pt = { x: number; y: number; z: number };

export interface NeutronShip {
  /** Laden jump range, unboosted (ly). */
  rangeLy: number;
  /** Supercharge factor (the game's neutron jet: 4). */
  boost?: number;
  jumpsPerTank: number;
  jumpsNow: number;
  /** FSD health now (0..1) and its wear per supercharge (0..1); both optional. */
  fsdHealth?: number | null;
  wearPerBoost?: number | null;
}

export interface NeutronHop {
  name: string;
  x: number;
  y: number;
  z: number;
  kind: "start" | "neutron" | "waypoint";
  /** Jumps from the hop before it, and how many of them are supercharged (0 or 1). */
  jumps: number;
  boosted: number;
  distanceLy: number;
  /** Refuel here: the system's own scoopable star, this far from arrival (ls). */
  refuel: boolean;
  /** The normal jumps before this hop are more than the tank holds: scoop a K G B F O A M star on the way. */
  scoopOnWay: boolean;
  scoopLs: number | null;
  /** Fuel left after arriving, in jumps. */
  jumpsLeft: number;
  /** FSD health after this hop, when known. */
  fsdHealth: number | null;
}

export interface NeutronRoute {
  hops: NeutronHop[];
  jumps: number;
  boosted: number;
  distanceLy: number;
  /** Straight jumps without neutron stars, for comparison. */
  plainJumps: number;
  refuels: number;
  /** Index into hops of the first one with the FSD under 80 %, or null. */
  repairBefore: number | null;
  /** A leg the fuel model could not make safe (it goes on the plain plot), if any. */
  unsafeLegs: number[];
}

const NEIGHBOURS = 32;
/**
 * Weighted A*: a route a few jumps from the best, found in milliseconds instead of minutes. Measured 2026-10-13: 1.6
 * ran out of its 60,000 expansions in sparse space (a supercharge gains far less than 4R there), 5 fell back to the
 * plain plot, 2 found the best routes where it finished but not across sparse space, 3 always finished but once
 * took scooping on the way over neutron refuels (20 jumps for 11). So 2 first, 3 after.
 */
const PASSES: readonly { weight: number; expansions: number }[] = [
  // Closer to the best (Sol → Colonia 121 jumps, takes neutron refuels over scooping on the way) …
  { weight: 2, expansions: 20_000 },
  // … and, where that runs out in sparse space, greedier.
  { weight: 3, expansions: 60_000 },
];
const REFUEL_COST = 0.15;
/**
 * Scooping on a stretch of normal jumps costs this many jumps in the comparison: it takes time and the plot may not
 * pass a scoopable star where the tank needs one, so a neutron star with its own scoopable star wins when in reach.
 */
const ON_WAY_COST = 3;
/**
 * A neutron star's scoopable companion is a refuel stop only this close to arrival (ls): the first live plan put one
 * at 47,050 ls, a long supercruise for a tank of fuel (2026-10-13).
 */
export const MAX_SCOOP_LS = 5000;
const FSD_WARN = 0.8;

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

function jumpsFrom(
  fromNeutron: boolean,
  d: number,
  r: number,
  boost: number,
): { jumps: number; boosted: number } {
  if (d <= 0) return { jumps: 0, boosted: 0 };
  if (!fromNeutron) return { jumps: Math.ceil(d / r - 1e-9), boosted: 0 };
  if (d <= boost * r) return { jumps: 1, boosted: 1 };
  return { jumps: 1 + Math.ceil((d - boost * r) / r - 1e-9), boosted: 1 };
}

interface Node {
  key: string;
  star: NeutronStar | null;
  pos: Pt;
  g: number;
  f: number;
  fuel: number;
  prev: Node | null;
  jumps: number;
  boosted: number;
  refuel: boolean;
  onWay: boolean;
}

/** A small binary heap on f. */
class Heap {
  private a: Node[] = [];
  get size() {
    return this.a.length;
  }
  push(n: Node) {
    const a = this.a;
    a.push(n);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p]!.f <= a[i]!.f) break;
      [a[p], a[i]] = [a[i]!, a[p]!];
      i = p;
    }
  }
  pop(): Node | undefined {
    const a = this.a;
    const top = a[0];
    const last = a.pop();
    if (a.length && last) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l]!.f < a[m]!.f) m = l;
        if (r < a.length && a[r]!.f < a[m]!.f) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i]!, a[m]!];
        i = m;
      }
    }
    return top;
  }
}

/** One leg, from a point (a neutron star or not) to a point, with `fuel` jumps in the tank. Null when no safe way. */
export async function planLeg(
  index: Pick<NeutronIndex, "within">,
  from: { pos: Pt; star: NeutronStar | null },
  to: Pt,
  ship: NeutronShip,
  fuel: number,
): Promise<{ nodes: Node[]; fuel: number } | null> {
  for (const pass of PASSES) {
    const leg = await searchLeg(index, from, to, ship, fuel, pass.weight, pass.expansions);
    if (leg) return leg;
  }
  return null;
}

/** The server runs in Electron's main process: a search hands the event loop back this often (expansions). */
const YIELD_EVERY = 1000;

async function searchLeg(
  index: Pick<NeutronIndex, "within">,
  from: { pos: Pt; star: NeutronStar | null },
  to: Pt,
  ship: NeutronShip,
  fuel: number,
  weight: number,
  maxExpansions: number,
): Promise<{ nodes: Node[]; fuel: number } | null> {
  const r = Math.max(1, ship.rangeLy);
  const boost = ship.boost ?? 4;
  const reach = boost * r;
  const tank = Math.max(1, Math.floor(ship.jumpsPerTank));
  const h = (p: Pt) => (weight * dist(p, to)) / reach;
  const open = new Heap();
  /** Per star, the (jumps so far, fuel) pairs already reached: a new one is kept only if no pair dominates it. */
  const reached = new Map<string, { g: number; fuel: number }[]>();
  const dominated = (key: string, g: number, f: number) =>
    (reached.get(key) ?? []).some((p) => p.g <= g + 1e-9 && p.fuel >= f);
  const remember = (key: string, g: number, f: number) => {
    const list = (reached.get(key) ?? []).filter((p) => !(p.g >= g && p.fuel <= f));
    list.push({ g, fuel: f });
    reached.set(key, list);
  };
  const start: Node = {
    key: "start",
    star: from.star,
    pos: from.pos,
    g: 0,
    f: h(from.pos),
    fuel,
    prev: null,
    jumps: 0,
    boosted: 0,
    refuel: false,
    onWay: false,
  };
  open.push(start);
  let expansions = 0;
  while (open.size && expansions < maxExpansions) {
    const u = open.pop()!;
    if (u.key === "goal") {
      const out: Node[] = [];
      for (let n: Node | null = u; n; n = n.prev) out.push(n);
      return { nodes: out.reverse(), fuel: u.fuel };
    }
    if (u.key !== "start" && (reached.get(u.key) ?? []).some((p) => p.g < u.g - 1e-9 && p.fuel >= u.fuel))
      continue;
    expansions++;
    if (expansions % YIELD_EVERY === 0) await new Promise((r) => setImmediate(r));
    const isNeutron = u.star != null;
    const left = dist(u.pos, to);
    // The end itself.
    /*
      Fuel for a hop: its supercharged jump comes out of the tank; normal jumps beyond what the tank holds are only
      possible scooping on the way (the game's plot passes ordinary K G B F O A M stars, a third of all systems),
      and leave the tank about full. A hop that is all supercharge must fit the fuel aboard.
    */
    const afterHop = (j: { jumps: number; boosted: number }): { fuel: number; onWay: boolean } | null => {
      if (j.jumps <= u.fuel) return { fuel: u.fuel - j.jumps, onWay: false };
      // Reaching a scoopable star on the way takes a jump of fuel itself, on top of the supercharge (review 1.2.16).
      if (j.jumps - j.boosted >= 2 && u.fuel >= j.boosted + 1) return { fuel: tank - 1, onWay: true };
      return null;
    };
    const toEnd = jumpsFrom(isNeutron, left, r, boost);
    const endFuel = afterHop(toEnd);
    if (endFuel) {
      const g = u.g + toEnd.jumps + (endFuel.onWay ? ON_WAY_COST : 0);
      open.push({
        key: "goal",
        star: null,
        pos: to,
        g,
        f: g,
        fuel: endFuel.fuel,
        prev: u,
        jumps: toEnd.jumps,
        boosted: toEnd.boosted,
        refuel: false,
        onWay: endFuel.onWay,
      });
    }
    // Neutron stars that bring the end nearer, the best by distance gained; further out when none is in reach
    // (the bubble has 2 within 240 ly of Sol), the extra distance in normal jumps.
    let cands: { n: NeutronStar; gain: number }[] = [];
    for (const radius of [reach, reach * 2, reach * 4, Math.max(reach * 4, 1500)]) {
      cands = index
        .within(u.pos, radius)
        .map((n) => ({ n, gain: left - dist(n, to) }))
        .filter((c) => c.gain > r * 0.5 && c.n.i !== u.star?.i);
      if (cands.length >= 8) break;
    }
    cands = cands.sort((a, b) => b.gain - a.gain).slice(0, NEIGHBOURS);
    for (const { n } of cands) {
      const d = dist(u.pos, n);
      const j = jumpsFrom(isNeutron, d, r, boost);
      const arrive = afterHop(j);
      if (!arrive) continue;
      const key = `n${n.i}`;
      // Arrive as is (with fuel for at least one more jump), or scoop the system's own star and leave full.
      const base = u.g + j.jumps + (arrive.onWay ? ON_WAY_COST : 0);
      const options: { fuel: number; g: number; refuel: boolean }[] = [];
      if (arrive.fuel >= 1) options.push({ fuel: arrive.fuel, g: base, refuel: false });
      if (n.scoopLs != null && n.scoopLs <= MAX_SCOOP_LS && arrive.fuel < tank)
        options.push({ fuel: tank, g: base + REFUEL_COST, refuel: true });
      for (const o of options) {
        if (dominated(key, o.g, o.fuel)) continue;
        remember(key, o.g, o.fuel);
        open.push({
          key,
          star: n,
          pos: n,
          g: o.g,
          f: o.g + h(n),
          fuel: o.fuel,
          prev: u,
          jumps: j.jumps,
          boosted: j.boosted,
          refuel: o.refuel,
          onWay: arrive.onWay,
        });
      }
    }
  }
  lastLegStats = { expansions, open: open.size };
  return null;
}

/** For probes: how far the last failed leg got. */
export let lastLegStats: { expansions: number; open: number } | null = null;

/** The whole route through the waypoints in order (the first is where the ship starts). */
export async function planNeutronRoute(
  index: Pick<NeutronIndex, "within" | "nameOf">,
  waypoints: { name: string; x: number; y: number; z: number }[],
  ship: NeutronShip,
): Promise<NeutronRoute> {
  const r = Math.max(1, ship.rangeLy);
  const hops: NeutronHop[] = [];
  const first = waypoints[0]!;
  let health = ship.fsdHealth ?? null;
  const wear = ship.wearPerBoost ?? null;
  hops.push({
    name: first.name,
    x: first.x,
    y: first.y,
    z: first.z,
    kind: "start",
    jumps: 0,
    boosted: 0,
    distanceLy: 0,
    refuel: false,
    scoopOnWay: false,
    scoopLs: null,
    jumpsLeft: ship.jumpsNow,
    fsdHealth: health,
  });
  let fuel = Math.max(0, Math.floor(ship.jumpsNow));
  /*
    A leg that starts at a neutron star (the ship sits at one, or a stop is one) supercharges there: without it the
    first hop was planned as normal jumps (review 1.2.16).
  */
  const neutronAt = (p: Pt): NeutronStar | null => {
    let best: NeutronStar | null = null;
    for (const n of index.within(p, 0.25)) if (!best || dist(n, p) < dist(best, p)) best = n;
    return best;
  };
  const tank = Math.max(1, Math.floor(ship.jumpsPerTank));
  let from: { pos: Pt; star: NeutronStar | null } = { pos: first, star: neutronAt(first) };
  const unsafeLegs: number[] = [];
  let plainJumps = 0;
  for (let w = 1; w < waypoints.length; w++) {
    const to = waypoints[w]!;
    plainJumps += Math.ceil(dist(from.pos, to) / r - 1e-9);
    const leg = await planLeg(index, from, to, ship, fuel);
    if (!leg) {
      // No fuel-safe neutron way: the plain plot, flagged.
      unsafeLegs.push(w);
      const j = jumpsFrom(from.star != null, dist(from.pos, to), r, ship.boost ?? 4);
      if (j.boosted && health != null && wear != null) health -= wear;
      // More jumps than the fuel aboard: scooped on the way, so the tank is about full after (not empty).
      const onWay = j.jumps > fuel;
      fuel = onWay ? Math.max(0, tank - 1) : fuel - j.jumps;
      hops.push({
        name: to.name,
        x: to.x,
        y: to.y,
        z: to.z,
        kind: "waypoint",
        jumps: j.jumps,
        boosted: j.boosted,
        distanceLy: Math.round(dist(from.pos, to)),
        refuel: false,
        scoopOnWay: onWay,
        scoopLs: null,
        jumpsLeft: fuel,
        fsdHealth: health,
      });
      from = { pos: to, star: neutronAt(to) };
      continue;
    }
    let prevPos = from.pos;
    for (const n of leg.nodes.slice(1)) {
      if (n.boosted && health != null && wear != null) health = Math.max(0, health - wear * n.boosted);
      const isEnd = n.key === "goal";
      hops.push({
        name: isEnd ? to.name : index.nameOf(n.star!.i),
        x: n.pos.x,
        y: n.pos.y,
        z: n.pos.z,
        kind: isEnd ? "waypoint" : "neutron",
        jumps: n.jumps,
        boosted: n.boosted,
        distanceLy: Math.round(dist(prevPos, n.pos)),
        refuel: n.refuel,
        scoopOnWay: n.onWay,
        scoopLs: n.star?.scoopLs ?? null,
        jumpsLeft: n.fuel,
        fsdHealth: health,
      });
      prevPos = n.pos;
    }
    fuel = leg.fuel;
    from = { pos: to, star: neutronAt(to) };
  }
  const repairBefore = hops.findIndex((h) => h.fsdHealth != null && h.fsdHealth < FSD_WARN);
  return {
    hops,
    jumps: hops.reduce((a, h) => a + h.jumps, 0),
    boosted: hops.reduce((a, h) => a + h.boosted, 0),
    distanceLy: hops.reduce((a, h) => a + h.distanceLy, 0),
    plainJumps,
    refuels: hops.filter((h) => h.refuel).length,
    repairBefore: repairBefore >= 0 ? repairBefore : null,
    unsafeLegs,
  };
}

/** Waypoints in the shortest straight-line order, the first and the last kept (up to 8 in between: every order). */
export function optimiseOrder<T extends Pt>(points: T[]): T[] {
  if (points.length <= 3) return points;
  const mid = points.slice(1, -1);
  if (mid.length > 8) return points;
  const first = points[0]!;
  const last = points[points.length - 1]!;
  let bestOrder = mid;
  let bestLen = Infinity;
  const perm = (arr: T[], k: number) => {
    if (k === arr.length) {
      let len = dist(first, arr[0]!);
      for (let i = 1; i < arr.length; i++) len += dist(arr[i - 1]!, arr[i]!);
      len += dist(arr[arr.length - 1]!, last);
      if (len < bestLen) {
        bestLen = len;
        bestOrder = [...arr];
      }
      return;
    }
    for (let i = k; i < arr.length; i++) {
      [arr[k], arr[i]] = [arr[i]!, arr[k]!];
      perm(arr, k + 1);
      [arr[k], arr[i]] = [arr[i]!, arr[k]!];
    }
  };
  perm([...mid], 0);
  return [first, ...bestOrder, last];
}

/**
 * Per hop, the FSD injections that would take a jump off its normal jumps (shared/jumponium.ts): after a supercharge
 * the rest of the hop is normal jumps (`jumps - 1` of them past 4R), else all of it.
 */
export function routeInjections(hops: readonly NeutronHop[], rangeLy: number, boost = 4): InjectionSave[][] {
  return hops.map((h, i) => {
    if (i === 0 || h.jumps < 2) return [];
    const d = dist(hops[i - 1]!, h);
    const normalLy = h.boosted ? d - boost * rangeLy : d;
    return injectionsToSaveJump(normalLy, h.jumps - h.boosted, rangeLy);
  });
}

/** A hop planned with an FSD injection ("Use Jumponium", owner 2026-10-13): what it takes, one jump fewer. */
export type JumpHop = NeutronHop & { inject: InjectionSave | null };

export interface JumponiumPlan {
  /** Jumps the injections take off the route. */
  saved: number;
  /** Injections of each tier the route uses. */
  used: Record<InjectionTier, number>;
  /** The materials they take, by element. */
  needs: Partial<Record<JumpElement, number>>;
  /** Hops where an injection would take a jump off but the materials held do not cover it (0 without a stock). */
  short: number;
}

/**
 * The route flown with FSD injections: on every hop where one takes a jump off, the cheapest way by material rarity
 * (the recipe's grades summed: basic 5, standard 11, premium 16 an injection), and that jump taken off. Fuel stays as
 * planned (one jump fewer only leaves more in the tank).
 *
 * With `stock` (the materials held, from the journals) only what they make (owner, 2026-10-15: "fix jumponium use when
 * not available"): the hops whose cheapest way costs least go first, each taking the cheapest tier the materials left
 * still cover, so the most jumps are saved; a hop nothing covers keeps its jumps and counts in `short`. Without a stock
 * (no Materials line read yet) every hop is planned, as before.
 */
export function applyJumponium(
  route: NeutronRoute,
  rangeLy: number,
  boost = 4,
  recipe: (t: InjectionTier) => Partial<Record<JumpElement, number>> = (t) => INJECTIONS.find((i) => i.tier === t)!.recipe,
  stock: Partial<Record<JumpElement, number>> | null = null,
): { route: Omit<NeutronRoute, "hops"> & { hops: JumpHop[] }; plan: JumponiumPlan } {
  const options = routeInjections(route.hops, rangeLy, boost);
  const cost = (t: InjectionTier) =>
    (Object.entries(recipe(t)) as [JumpElement, number][]).reduce((a, [k, q]) => a + jumpElement(k).grade * q, 0);
  const price = (o: InjectionSave) => o.count * cost(o.tier);
  const left: Partial<Record<JumpElement, number>> | null = stock ? { ...stock } : null;
  const fits = (o: InjectionSave) =>
    !left ||
    (Object.entries(recipe(o.tier)) as [JumpElement, number][]).every(([k, q]) => (left[k] ?? 0) >= q * o.count);
  const chosen = new Map<number, InjectionSave>();
  let short = 0;
  const order = options
    .map((opts, i) => ({ i, opts: [...opts].sort((x, y) => price(x) - price(y)) }))
    .filter((x) => x.opts.length)
    .sort((x, y) => price(x.opts[0]!) - price(y.opts[0]!) || x.i - y.i);
  for (const { i, opts } of order) {
    const best = opts.find(fits);
    if (!best) {
      short++;
      continue;
    }
    chosen.set(i, best);
    if (left)
      for (const [k, q] of Object.entries(recipe(best.tier)) as [JumpElement, number][]) left[k] = (left[k] ?? 0) - q * best.count;
  }
  const used: Record<InjectionTier, number> = { basic: 0, standard: 0, premium: 0 };
  const needs: Partial<Record<JumpElement, number>> = {};
  let saved = 0;
  const hops: JumpHop[] = route.hops.map((h, i) => {
    const best = chosen.get(i);
    if (!best) return { ...h, inject: null };
    used[best.tier] += best.count;
    for (const [k, q] of Object.entries(recipe(best.tier)) as [JumpElement, number][]) needs[k] = (needs[k] ?? 0) + q * best.count;
    saved++;
    return { ...h, jumps: h.jumps - 1, inject: best };
  });
  return { route: { ...route, hops, jumps: route.jumps - saved }, plan: { saved, used, needs, short } };
}
