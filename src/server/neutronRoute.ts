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
 * - The range grows as the tank empties (`rangeByFuel`): a hop goes by the fuel aboard where it starts; with
 *   `halfTank` a refuel stop may scoop to half a tank, not full, where the lighter ship gets further (Spansh's way).
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
  /** Laden jump range, unboosted (ly), with a full tank. */
  rangeLy: number;
  /**
   * The range by the fuel aboard, as multiples of `rangeLy`: entry i for a tank i / (length - 1) full (the last is 1).
   * A lighter tank jumps further (owner, 2026-10-28: "Spansh … intentionally keeps fuel below the half point so that
   * jump ranges are higher"). Without it, `rangeLy` at every fuel level.
   */
  rangeByFuel?: number[] | null;
  /**
   * Refuel stops may scoop to half a tank (the drawer's switch, off by default): measured 2026-10-28 on Sol → Colonia /
   * Sagittarius A* / Beagle Point, a few jumps fewer at most for nearly twice the scoop stops.
   */
  halfTank?: boolean;
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
  /** Scoop to half a tank, not full: the plan counts on the lighter ship's range. */
  refuelHalf?: boolean;
  /** The normal jumps before this hop are more than the tank holds: scoop a K G B F O A M star on the way. */
  scoopOnWay: boolean;
  scoopLs: number | null;
  /** Fuel left after arriving, in jumps. */
  jumpsLeft: number;
  /**
   * The unboosted range this hop is planned with (ly): the fuel aboard as it leaves sets it, so a part tank reaches
   * past the full tank's ×4 (a tester read 305-317 ly hops on a 74 ly ×4 ship as wrong, 2026-10-28).
   */
  rangeLy?: number;
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
/**
 * Then towards the fewest jumps (owner, 2026-10-28: "should be the fastest route, A* or similar"): the first route
 * was 117 jumps Sol to Colonia (60 ly x4) where plain A* finds 104, in four minutes. Passes at lower weights look for
 * a cheaper route, skipping any state that cannot beat the best so far, each in its share of a time budget; the
 * best found wins. Which weight finds it differs from route to route, and a lower one is not always slower
 * (measured 2026-10-28, docs/perf/_neutron-optimal.mts: Colonia 60 ly x4 106 jumps at 1.2 in 0.3 s, 105 at 1.1;
 * Colonia 93 ly x6 48 at 1.1 in 0.2 s, where 1.2 ran 30 s; Sagittarius A* 135 at 1.3), so each gets its turn.
 * Plain A* (1) did not finish in 30 s on any of the six test routes.
 */
const REFINE_WEIGHTS: readonly number[] = [1.5, 1.3, 1.2, 1.1];
/** The time for the refining passes of a whole plan (shared out between its legs). */
const REFINE_MS = 3000;
const REFINE_EXPANSIONS = 500_000;
const REFUEL_COST = 0.15;
/** A refuel to half a tank costs this much less than to full: the lighter ship's range is worth a little. */
const HALF_TANK_EDGE = 0.05;
/**
 * Scooping on a stretch of normal jumps costs this many jumps in the comparison: it takes time and the plot may not
 * pass a scoopable star where the tank needs one, so a neutron star with its own scoopable star wins when in reach.
 */
const ON_WAY_COST = 3;
/**
 * A hop past a supercharge's reach (the supercharge, then the game's plot for the rest) costs this many jumps more in
 * the comparison (owner, 2026-10-28): the game's plot may need more jumps than the count, it is one more plot by hand,
 * and a tester took a 905 ly hop for a broken one. A neutron star in reach wins whenever the counts are close.
 */
const PAST_REACH_COST = 0.5;
/**
 * A neutron star's scoopable companion is a refuel stop only this close to arrival (ls): the first live plan put one
 * at 47,050 ls, a long supercruise for a tank of fuel (2026-10-13).
 */
export const MAX_SCOOP_LS = 5000;
const FSD_WARN = 0.8;

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/** The unboosted range (ly) with `fuel` jumps of fuel in a tank of `tank`: `rangeByFuel` read between its entries. */
export function rangeAt(ship: Pick<NeutronShip, "rangeLy" | "rangeByFuel">, fuel: number, tank: number): number {
  const r = Math.max(1, ship.rangeLy);
  const t = ship.rangeByFuel;
  if (!t || t.length < 2) return r;
  const x = Math.min(1, Math.max(0, fuel / Math.max(1, tank))) * (t.length - 1);
  const i = Math.min(t.length - 2, Math.floor(x));
  const m = t[i]! + (t[i + 1]! - t[i]!) * (x - i);
  return Number.isFinite(m) && m > 0 ? r * m : r;
}

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
  /** Scooped to half a tank (`refuel` and less than full). */
  half?: boolean;
  onWay: boolean;
}

/** Before in the heap: lower f, and with `deeper` at equal f the state with more g, which reaches a goal sooner. */
const before = (x: Node, y: Node, deeper: boolean) =>
  x.f < y.f - 1e-9 || (deeper && x.f <= y.f + 1e-9 && x.g > y.g);

/** A small binary heap on f. */
class Heap {
  private a: Node[] = [];
  constructor(private readonly deeper = false) {}
  get size() {
    return this.a.length;
  }
  push(n: Node) {
    const a = this.a;
    a.push(n);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!before(a[i]!, a[p]!, this.deeper)) break;
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
        if (l < a.length && before(a[l]!, a[m]!, this.deeper)) m = l;
        if (r < a.length && before(a[r]!, a[m]!, this.deeper)) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i]!, a[m]!];
        i = m;
      }
    }
    return top;
  }
}

/** The `size` items with the largest gain seen so far, in no order. */
class TopByGain<T extends { gain: number }> {
  readonly items: T[] = [];
  private min = 0;
  constructor(private readonly size: number) {}
  get count() {
    return this.items.length;
  }
  clear() {
    this.items.length = 0;
  }
  /** The gain an item needs to be kept: none while there is room. */
  floor() {
    return this.items.length < this.size ? -Infinity : this.items[this.min]!.gain;
  }
  /** Whether an item with this gain would be kept. */
  takes(gain: number) {
    return this.items.length < this.size || gain > this.items[this.min]!.gain;
  }
  add(c: T) {
    const a = this.items;
    if (a.length < this.size) {
      a.push(c);
      if (a.length === this.size) this.min = this.lowest();
      return;
    }
    if (c.gain <= a[this.min]!.gain) return;
    a[this.min] = c;
    this.min = this.lowest();
  }
  private lowest() {
    let m = 0;
    for (let i = 1; i < this.items.length; i++) if (this.items[i]!.gain < this.items[m]!.gain) m = i;
    return m;
  }
}

type Cand = { n: NeutronStar; gain: number; d: number };
/** A star's neighbours as the refining passes keep them, best gain first. */
type Kept = { stars: NeutronStar[]; gain: Float64Array; d: Float64Array };
type Leg = { nodes: Node[]; fuel: number; g: number };

/** One leg, from a point (a neutron star or not) to a point, with `fuel` jumps in the tank. Null when no safe way. */
export async function planLeg(
  index: Pick<NeutronIndex, "within"> & Partial<Pick<NeutronIndex, "eachToward">>,
  from: { pos: Pt; star: NeutronStar | null },
  to: Pt,
  ship: NeutronShip,
  fuel: number,
  budgetMs = REFINE_MS,
): Promise<{ nodes: Node[]; fuel: number } | null> {
  // The neighbours of a star are the same in every pass: read once.
  const lists = new Map<string, Kept>();
  const began = Date.now();
  let best: Leg | null = null;
  /*
    The first route scoops to a full tank: the refining passes take a half tank only where it makes the route
    cheaper. Offered half tanks from the start, the greedy first passes took them where they cost jumps, and the
    switch made a route worse (owner's Mandalay, Sagittarius-Carina arm to Colonia: 94 jumps for 93, 7 more stops).
  */
  const first = ship.halfTank ? { ...ship, halfTank: false } : ship;
  for (const pass of PASSES) {
    best = await searchLeg(index, from, to, first, fuel, pass.weight, pass.expansions, lists);
    if (best) break;
  }
  if (!best) return null;
  /*
    The budget counts the first route's time too, the refining passes getting what is left and never less than a
    third: from the Sagittarius-Carina arm to Colonia the first route alone took 4 s, and the plan 7 (owner,
    2026-10-28 test round). Where the first route comes quickly (Sol to Colonia, under a second) nothing changes.
  */
  const deadline = Math.max(began + budgetMs, Date.now() + budgetMs / 3);
  for (let k = 0; k < REFINE_WEIGHTS.length; k++) {
    const now = Date.now();
    if (now >= deadline) break;
    // Its share of what is left: a pass stuck on a plateau must not starve the next weight.
    const until = now + (deadline - now) / (REFINE_WEIGHTS.length - k);
    const leg = await searchLeg(index, from, to, ship, fuel, REFINE_WEIGHTS[k]!, REFINE_EXPANSIONS, lists, best.g, until);
    // Null: out of time or steps, or nothing cheaper exists.
    if (leg && leg.g < best.g - 1e-9) best = leg;
  }
  return best;
}

/** A search hands the server's event loop back this often (ms): the HUD and status keep flowing during a plan. */
const YIELD_MS = 15;

async function searchLeg(
  index: Pick<NeutronIndex, "within"> & Partial<Pick<NeutronIndex, "eachToward">>,
  from: { pos: Pt; star: NeutronStar | null },
  to: Pt,
  ship: NeutronShip,
  fuel: number,
  weight: number,
  maxExpansions: number,
  lists: Map<string, Kept>,
  /** Only a route cheaper than this is wanted (a refining pass). */
  bound = Infinity,
  deadline = Infinity,
): Promise<Leg | null> {
  const boost = ship.boost ?? 4;
  const tank = Math.max(1, Math.floor(ship.jumpsPerTank));
  const rangeWith = (fuel: number) => rangeAt(ship, fuel, tank);
  const ranges = ship.rangeByFuel?.length ? ship.rangeByFuel : [1];
  const maxR = Math.max(1, ship.rangeLy) * Math.max(1, ...ranges);
  const minR = Math.max(1, ship.rangeLy) * Math.min(1, ...ranges);
  /*
    Jumps still needed, at least: a supercharge at the longest range any fuel gives, every jump. Never more than the
    true count, so weight 1 finds the fewest, and a state whose g plus this reaches the bound cannot beat it.
  */
  const least = (p: Pt) => dist(p, to) / (boost * maxR);
  // The first passes go by the full tank's reach, as before the range followed the fuel (greedier: they must finish
  // across sparse space); the refining ones by the bound above.
  const h = bound === Infinity ? (p: Pt) => (weight * dist(p, to)) / (boost * Math.max(1, ship.rangeLy)) : (p: Pt) => weight * least(p);
  // The first passes order states as they always did, so their route is the one plans had before the refining
  // passes (which can only improve on it); the refining ones go deeper first on a tie, a plateau of equal counts.
  const open = new Heap(bound !== Infinity);
  /*
    Per star, the (jumps so far, fuel) pairs already reached: a new one is kept only if no pair dominates it. More fuel
    is more jumps to come, less fuel a longer range: a pair dominates with fewer jumps, at least the fuel and at least
    the range (the same fuel, once the range follows the fuel).
  */
  const reached = new Map<string, { g: number; fuel: number }[]>();
  const better = (p: { g: number; fuel: number }, g: number, f: number) =>
    p.g <= g + 1e-9 && p.fuel >= f && rangeWith(p.fuel) >= rangeWith(f) - 1e-9;
  const dominated = (key: string, g: number, f: number) => (reached.get(key) ?? []).some((p) => better(p, g, f));
  const remember = (key: string, g: number, f: number) => {
    const list = (reached.get(key) ?? []).filter((p) => !better({ g, fuel: f }, p.g, p.fuel));
    list.push({ g, fuel: f });
    reached.set(key, list);
  };
  /*
    Neutron stars that bring the end nearer, the best by distance gained; further out when none is in reach (the
    bubble has 2 within 240 ly of Sol), the extra distance in normal jumps. Kept per star and range: a star is
    expanded again with other fuel, and building the list (thousands of stars near the core) was most of a plan's time.
  */
  const candidates = (u: Node, left: number, r: number, reach: number, isNeutron: boolean) =>
    bound === Infinity ? firstCandidates(u, left, r, reach, isNeutron) : keptCandidates(u, left, r, reach, isNeutron);
  /*
    The first passes pick neighbours as plans always did, from the stars in reach at this fuel, so their route is the
    one a plan had before the refining passes, which can then only improve on it.
  */
  const firstCandidates = (u: Node, left: number, r: number, reach: number, isNeutron: boolean) => {
    const hop = isNeutron ? reach : r;
    if (index.eachToward) {
      /*
        The same picks, without reading every star in reach: pick() takes the best 32 by gain in reach and the best
        32 further out, so only those are kept, and the walk skips what cannot beat them. Reading and sorting all of
        them took a plan from the Sagittarius-Carina arm to Colonia over 6 s before the time budget began (owner's
        route, 2026-10-28; docs/perf/_nr-bench.mts).
      */
      const min = r * 0.5;
      const inHop = new TopByGain<Cand>(NEIGHBOURS);
      const out = new TopByGain<Cand>(NEIGHBOURS);
      for (const radius of [reach, reach * 2, reach * 4, Math.max(reach * 4, 1500)]) {
        inHop.clear();
        out.clear();
        index.eachToward(
          u.pos,
          radius,
          to,
          (n, gain, d) => {
            if (gain > min && n.i !== u.star?.i) (d <= hop ? inHop : out).add({ n, gain, d });
          },
          (near) => Math.max(min, near <= hop ? Math.min(inHop.floor(), out.floor()) : out.floor()),
        );
        if (inHop.count + out.count >= 8) break;
      }
      return pick([...inHop.items, ...out.items].sort((a, b) => b.gain - a.gain), r, hop);
    }
    let all: Cand[] = [];
    for (const radius of [reach, reach * 2, reach * 4, Math.max(reach * 4, 1500)]) {
      all = [];
      for (const n of index.within(u.pos, radius)) {
        const gain = left - dist(n, to);
        if (gain > r * 0.5 && n.i !== u.star?.i) all.push({ n, gain, d: dist(u.pos, n) });
      }
      if (all.length >= 8) break;
    }
    all.sort((a, b) => b.gain - a.gain);
    return pick(all, r, hop);
  };
  const keptCandidates = (u: Node, left: number, r: number, reach: number, isNeutron: boolean) => {
    let all = lists.get(u.key);
    if (!all) {
      /*
        Read once per star at the longest range any fuel gives (a star is expanded again with other fuel), keeping
        only the best by gain: overall, and among the ones in reach at any fuel. Near the core a supercharge reaches
        thousands of neutron stars, and sorting them all on every expansion was most of a plan's time.
      */
      const most = boost * maxR;
      const sure = (isNeutron ? boost : 1) * minR;
      const best = new TopByGain<Cand>(NEIGHBOURS * 1.5);
      const inReach = new TopByGain<Cand>(NEIGHBOURS);
      for (const radius of [most, most * 2, most * 4, Math.max(most * 4, 1500)]) {
        best.clear();
        inReach.clear();
        const visit = (n: NeutronStar, gain: number, d: number) => {
          if (n.i === u.star?.i) return;
          const near = d <= sure;
          if (!best.takes(gain) && !(near && inReach.takes(gain))) return;
          const c = { n, gain, d };
          best.add(c);
          if (near) inReach.add(c);
        };
        if (index.eachToward)
          index.eachToward(u.pos, radius, to, visit, (near) =>
            near <= sure ? Math.min(best.floor(), inReach.floor()) : best.floor(),
          );
        else
          for (const n of index.within(u.pos, radius)) {
            const gain = left - dist(n, to);
            if (gain > 0) visit(n, gain, dist(u.pos, n));
          }
        // Further out only where too few make progress (the best kept hold them if there are 8), as before.
        if (best.items.filter((c) => c.gain > minR * 0.5).length >= 8) break;
      }
      const seen = new Set<number>();
      const merged = [...best.items, ...inReach.items].filter((c) => !seen.has(c.n.i) && seen.add(c.n.i));
      merged.sort((a, b) => b.gain - a.gain);
      // Kept compact for the whole leg (tens of thousands of stars on a long one): the stars and two number arrays.
      all = {
        stars: merged.map((c) => c.n),
        gain: Float64Array.from(merged, (c) => c.gain),
        d: Float64Array.from(merged, (c) => c.d),
      };
      lists.set(u.key, all);
    }
    const out: Cand[] = [];
    for (let k = 0; k < all.stars.length; k++) out.push({ n: all.stars[k]!, gain: all.gain[k]!, d: all.d[k]! });
    return pick(out, r, isNeutron ? reach : r);
  };
  /*
    The ones a supercharge reaches stay, however far the search looked: ranked by gain alone, a crowd further out
    took all 32 places, and the plan went by hops of one supercharge and the game's plot for the rest (a tester's
    Caspian, 2026-10-28: "the next in line was 905 ly away", where a neutron star in reach went on).
  */
  const pick = (all: Cand[], r: number, hop: number) => {
    const near: Cand[] = [];
    const far: Cand[] = [];
    for (const c of all) {
      if (c.gain <= r * 0.5) break;
      if (c.d <= hop) {
        if (near.length < NEIGHBOURS) near.push(c);
      } else if (far.length < NEIGHBOURS) far.push(c);
      if (near.length >= NEIGHBOURS && far.length >= NEIGHBOURS / 4) break;
    }
    return {
      cands: [...near, ...far.slice(0, Math.max(NEIGHBOURS / 4, NEIGHBOURS - near.length))],
      anyNear: near.length > 0,
    };
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
  let lastYield = Date.now();
  while (open.size && expansions < maxExpansions) {
    const u = open.pop()!;
    if (u.key === "goal") {
      const out: Node[] = [];
      for (let n: Node | null = u; n; n = n.prev) out.push(n);
      return { nodes: out.reverse(), fuel: u.fuel, g: u.g };
    }
    if (
      u.key !== "start" &&
      (reached.get(u.key) ?? []).some(
        (p) => p.g < u.g - 1e-9 && p.fuel >= u.fuel && rangeWith(p.fuel) >= rangeWith(u.fuel) - 1e-9,
      )
    )
      continue;
    expansions++;
    if ((expansions & 63) === 0) {
      const now = Date.now();
      if (now > deadline) break;
      if (now - lastYield >= YIELD_MS) {
        await new Promise((r) => setImmediate(r));
        lastYield = Date.now();
      }
    }
    const isNeutron = u.star != null;
    const left = dist(u.pos, to);
    // The range with the fuel aboard here: the hop's first jump, the longest of them (the conservative count).
    const r = rangeWith(u.fuel);
    const reach = boost * r;
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
    const endG = endFuel ? u.g + toEnd.jumps + (endFuel.onWay ? ON_WAY_COST : 0) : Infinity;
    if (endFuel && endG < bound - 1e-9) {
      const g = endG;
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
    const { cands, anyNear } = candidates(u, left, r, reach, isNeutron);
    // A hop past reach costs more only where one in reach goes on: in sparse space every hop is past reach, and the
    // cost on each ran the search out of steps (Sol to Beagle Point, 60 ly x4: the plain plot).
    const pastReach = isNeutron && anyNear ? PAST_REACH_COST : 0;
    for (const { n } of cands) {
      const d = dist(u.pos, n);
      const j = jumpsFrom(isNeutron, d, r, boost);
      const arrive = afterHop(j);
      if (!arrive) continue;
      const key = `n${n.i}`;
      // Arrive as is (with fuel for at least one more jump), or scoop the system's own star and leave full.
      const base =
        u.g + j.jumps + (arrive.onWay ? ON_WAY_COST : 0) + (j.boosted && j.jumps > 1 ? pastReach : 0);
      const options: { fuel: number; g: number; refuel: boolean; half?: boolean }[] = [];
      if (arrive.fuel >= 1) options.push({ fuel: arrive.fuel, g: base, refuel: false });
      if (n.scoopLs != null && n.scoopLs <= MAX_SCOOP_LS && arrive.fuel < tank) {
        options.push({ fuel: tank, g: base + REFUEL_COST, refuel: true });
        /*
          Half a tank: fewer jumps before the next scoop, each of them longer (only where the range follows the fuel).
          A shade cheaper than full: at the same count the weighted search went down the full tank's branch first and
          never came back (a supercharge and a normal jump a hop where half a tank made one).
        */
        const half = Math.ceil(tank / 2);
        if (ship.halfTank && ship.rangeByFuel && half > arrive.fuel && half < tank)
          options.push({ fuel: half, g: base + REFUEL_COST - HALF_TANK_EDGE, refuel: true, half: true });
      }
      for (const o of options) {
        if (o.g + least(n) >= bound - 1e-9 || dominated(key, o.g, o.fuel)) continue;
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
          half: o.half,
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
  index: Pick<NeutronIndex, "within" | "nameOf"> & Partial<Pick<NeutronIndex, "eachToward">>,
  waypoints: { name: string; x: number; y: number; z: number }[],
  ship: NeutronShip,
  /** Time for the refining passes (ms): a re-plot in flight wants the next stop soon more than a jump less. */
  refineMs = REFINE_MS,
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
    const leg = await planLeg(index, from, to, ship, fuel, refineMs / (waypoints.length - 1));
    if (!leg) {
      // No fuel-safe neutron way: the plain plot, flagged.
      unsafeLegs.push(w);
      const legRange = rangeAt(ship, fuel, tank);
      const j = jumpsFrom(from.star != null, dist(from.pos, to), legRange, ship.boost ?? 4);
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
        rangeLy: Math.round(legRange * 10) / 10,
        fsdHealth: health,
      });
      from = { pos: to, star: neutronAt(to) };
      continue;
    }
    let prevPos = from.pos;
    // The fuel aboard as each hop leaves: the leg's start, then what the hop before arrived with (or scooped to).
    let leaving = fuel;
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
        ...(n.half ? { refuelHalf: true } : {}),
        scoopOnWay: n.onWay,
        scoopLs: n.star?.scoopLs ?? null,
        jumpsLeft: n.fuel,
        rangeLy: Math.round(rangeAt(ship, leaving, tank) * 10) / 10,
        fsdHealth: health,
      });
      prevPos = n.pos;
      leaving = n.fuel;
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
