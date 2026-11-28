/**
 * Where a boxel's systems are, for the shortest order (shared/boxelOrder.ts): every route he plotted (NavRoute.json
 * gives each system's StarPos, the destination too; server/navRouteLog.ts keeps them), the systems he has flown (the
 * journals' own StarPos), then Spansh's look-up of the boxel (server/boxelLookup.ts), then the catalogue stars that
 * ship with the app (server/boxelCatalogue.ts: real stars the dice do not place, owner 2026-11-28), then the place the
 * game's own dice give it (shared/stellarPlacement.ts; owner, 2026-11-24). A galaxy-map target gives none: FSDTarget and Status.json carry a name and an address only (owner's
 * test, 2026-11-04), and the address places a g system no closer than its 640 ly cube.
 *
 * The third source is a prediction and is told apart ({@link BoxelPositionSet.predicted}). A boxel is of one of two
 * kinds, and the prediction is exact once the kind is right: the seen positions say which it is, where he is
 * included; with none seen, where the boxel is in the galaxy says it (far from the centre, as around Sol, every
 * boxel is of the normal kind); in the zone between it is taken from the boxels of its sector he has flown or plotted
 * (the kind is shared round a boxel: owner 2026-11-28, docs/boxel-star-placement-23112026.md §3m), else guessed from
 * how crowded the boxel is, and nothing is predicted when that guess is close to a coin toss. Not made for mass code h.
 */
import { boxelIndexOf, parseBoxel } from "../shared/boxel.js";
import { boxelPositionOf, MASS_CODE_LETTERS, type MassCode } from "../shared/boxelAdvice.js";
import type { Vec3 } from "../shared/boxelOrder.js";
import {
  boxelFrame,
  boxelFrameAt,
  boxelKindFrom,
  likelyBoxelKind,
  PLACEMENT_EXACT_KNOWN_KIND,
  PLACEMENT_MIN_EXACT,
  placementKnown,
  predictBoxelPlacement,
  type BoxelFrame,
  type BoxelKind,
} from "../shared/stellarPlacement.js";
import { SECTOR_ORIGIN, SECTOR_SIZE_LY } from "../shared/sectorName.js";
import type { BoxelLookupRecord } from "./boxelLookup.js";
import { navRouteLog } from "./navRouteLog.js";

/** The look-ups kept by the Boxels routes (routes/boxelRoutes.ts); null until they are set up. */
let lookupOf: ((prefix: string) => BoxelLookupRecord | null) | null = null;

export function setBoxelLookupSource(get: ((prefix: string) => BoxelLookupRecord | null) | null): void {
  lookupOf = get;
}

/**
 * The systems of a boxel he has flown, with where the journals put them; null until set up. They are not left to
 * fly, but each is a seen position: it tells the boxel's kind and sets the chain right for the systems after it.
 */
let flownOf: ((prefix: string) => Iterable<{ n: number; address: number; pos: Vec3 }>) | null = null;

export function setBoxelFlownSource(
  get: ((prefix: string) => Iterable<{ n: number; address: number; pos: Vec3 }>) | null,
): void {
  flownOf = get;
}

/**
 * The catalogue stars of a boxel (`base`: the address of its system 0), number → position (server/boxelCatalogue.ts);
 * null until set up. Real positions the dice do not make: each takes its cell and the next system starts from it.
 */
let catalogueOf: ((base: bigint) => ReadonlyMap<number, Vec3>) | null = null;

export function setBoxelCatalogueSource(get: ((base: bigint) => ReadonlyMap<number, Vec3>) | null): void {
  catalogueOf = get;
  memo.clear();
}

/**
 * Every system he has flown that sits in a generated boxel (`size`: how many he has flown, for the cache); null until
 * set up. Their boxels' kinds give the kind of an unvisited boxel of the same sector.
 */
let everywhereOf: (() => { size: number; systems: Iterable<{ n: number; address: number; pos: Vec3 }> }) | null = null;

export function setBoxelSeenEverywhereSource(
  get: (() => { size: number; systems: Iterable<{ n: number; address: number; pos: Vec3 }> }) | null,
): void {
  everywhereOf = get;
  seenSectors = null;
  memo.clear();
}

/**
 * How often "the majority of the other boxels of its sector whose kind is known" names a boxel's kind, per mass code:
 * one sector in 40 of Spansh's positions, boxels 4,000 to 22,000 ly from the galaxy's centre, where the crowding
 * guess is weakest (docs/boxel-star-placement-23112026.md §3m: crowding a 82.7, b 90.0, c 85.2, d 95.5, e 75.4,
 * f 70.0 %). By how many boxels vote, the lowest share measured in that range (random voters of the sector, ties
 * left out: 1, 2, 3, 5 and all): one alone is right less often (b 82.7 %, below the crowding guess), and the vote is
 * taken only where it beats the crowding guess for that boxel. f: measured with all voters only (38 boxels).
 */
const SECTOR_VOTE_RIGHT: Record<"one" | "few" | "many", Partial<Record<MassCode, number>>> = {
  one: { a: 0.932, b: 0.827, c: 0.842, d: 0.951, e: 0.883 },
  few: { a: 0.934, b: 0.877, c: 0.88, d: 0.967, e: 0.918 },
  many: { a: 0.949, b: 0.893, c: 0.892, d: 0.972, e: 0.933, f: 0.97 },
};

/** The flown and plotted systems by sector, then boxel; with each boxel's kind once asked for. */
let seenSectors: {
  stamp: string;
  sectors: Map<string, Map<bigint, { frame: BoxelFrame; known: Map<number, Vec3> }>>;
  kinds: Map<string, Map<bigint, BoxelKind | null>>;
} | null = null;

const sectorKeyOf = (origin: Vec3): string =>
  `${Math.floor((origin[0] - SECTOR_ORIGIN.x) / SECTOR_SIZE_LY)},${Math.floor((origin[1] - SECTOR_ORIGIN.y) / SECTOR_SIZE_LY)},${Math.floor((origin[2] - SECTOR_ORIGIN.z) / SECTOR_SIZE_LY)}`;

function seenBySector(): NonNullable<typeof seenSectors> {
  const flownNow = everywhereOf?.() ?? { size: 0, systems: [] };
  const plotted = navRouteLog().systems;
  const stamp = `${flownNow.size}|${plotted.length}`;
  if (seenSectors?.stamp === stamp) return seenSectors;
  const sectors: NonNullable<typeof seenSectors>["sectors"] = new Map();
  const add = (address: number, n: number, pos: Vec3) => {
    const frame = Number.isSafeInteger(address) ? boxelFrame(address) : null;
    if (!frame || !placementKnown(frame.code)) return;
    const key = sectorKeyOf(frame.origin);
    let boxels = sectors.get(key);
    if (!boxels) sectors.set(key, (boxels = new Map()));
    let b = boxels.get(frame.base);
    if (!b) boxels.set(frame.base, (b = { frame, known: new Map() }));
    if (!b.known.has(n)) b.known.set(n, pos);
  };
  for (const s of flownNow.systems) add(s.address, s.n, s.pos);
  for (const s of plotted) {
    const b = s.pos ? parseBoxel(s.name) : null;
    if (b?.index != null) add(s.address, b.index, s.pos!);
  }
  seenSectors = { stamp, sectors, kinds: new Map() };
  return seenSectors;
}

/**
 * The kind most of the other boxels of this boxel's sector show (each read from its own seen positions, its
 * catalogue stars set aside), and how many boxels said so; null when none tells or they tie.
 */
function sectorKindOf(frame: BoxelFrame): { kind: BoxelKind; boxels: number } | null {
  const seen = seenBySector();
  const key = sectorKeyOf(frame.origin);
  const group = seen.sectors.get(key);
  if (!group) return null;
  let kinds = seen.kinds.get(key);
  if (!kinds) {
    kinds = new Map();
    for (const [base, b] of group) {
      const known = new Map(b.known);
      const notRolled = new Set<number>();
      for (const [n, p] of catalogueOf?.(base) ?? []) {
        notRolled.add(n);
        if (!known.has(n)) known.set(n, p);
      }
      const read = boxelKindFrom(b.frame, known, notRolled);
      kinds.set(base, read && read.hits >= PLACEMENT_MIN_EXACT * read.checked ? read.kind : null);
    }
    seen.kinds.set(key, kinds);
  }
  let normal = 0;
  let scatter = 0;
  for (const [base, kind] of kinds) {
    if (base === frame.base || !kind) continue;
    if (kind === "scatter") scatter++;
    else normal++;
  }
  if (normal === scatter) return null;
  return { kind: scatter > normal ? "scatter" : "normal", boxels: normal + scatter };
}

/** A generated sector's place on the 1,280 ly grid, by its name (data/boxel/sector-names.json); null until set up. */
let sectorCellOf: ((sector: string) => readonly [number, number, number] | null) | null = null;

export function setBoxelSectorSource(
  get: ((sector: string) => readonly [number, number, number] | null) | null,
): void {
  sectorCellOf = get;
}

export interface BoxelPositionSet {
  /** System number → position, light years. */
  positions: Map<number, Vec3>;
  /** The numbers whose position is predicted, not seen. */
  predicted: Set<number>;
  /** The share of such predictions that are exact, as measured; null when none are made. */
  exact: number | null;
  /**
   * How many seen positions the boxel's kind was read from; 0 when it was guessed from how crowded the boxel is
   * (shared/stellarPlacement.ts).
   */
  checked: number;
  /** How many other boxels of its sector the kind was taken from (0: not taken that way). */
  neighbours: number;
  /** The boxel as the placement sees it; null when it could not be worked out or nothing is predicted. */
  frame: BoxelFrame | null;
  /**
   * System number → where its dice stand once it is placed, for every number up to the boxel's highest; null unless
   * the boxel's kind is known (read from a seen position, or sure from where the boxel is). The star's own rolls
   * are counted from there (server/boxelStars.ts).
   */
  after: Map<number, number> | null;
}

/**
 * A boxel listed past this number gets no predictions. The shortest order is worked out again after every jump, on
 * the server's own thread, and its cost grows with the square of the placed systems (measured 2026-11-24: 14 ms for
 * 300, 240 ms for 2,000, 840 ms for 4,000); and the kinds of boxel are measured up to number 1,000.
 */
export const PREDICT_MAX_NUMBER = 1000;

/** The last few predictions: the Boxels screen and the run ask again after every refresh. */
type Made = { guess: Map<number, Vec3>; after: Map<number, number>; exact: number; checked: number; neighbours: number };
const memo = new Map<string, Made | null>();

/**
 * The boxel's frame: from the address of one of its systems when one is at hand (exact, and the only way for a
 * hand-named sector such as "Col 285 Sector"), else from its name through the sector's place on the grid.
 */
function frameOf(prefix: string, addresses: readonly number[]): BoxelFrame | null {
  const b = parseBoxel(`${prefix}0`);
  if (!b || !(MASS_CODE_LETTERS as readonly string[]).includes(b.massCode)) return null;
  for (const a of addresses) {
    const f = Number.isSafeInteger(a) ? boxelFrame(a) : null;
    if (f?.code === b.massCode) return f;
  }
  const cell = sectorCellOf?.(b.sector);
  const position = boxelPositionOf(b.boxel);
  return cell && position != null ? boxelFrameAt(b.massCode as MassCode, cell, position) : null;
}

/**
 * The boxel's frame from what is known of it (an address of one of its systems, else its sector's place), whether or
 * not its positions can be predicted; null when neither is at hand. Each system's own dice follow from it.
 */
export function boxelFrameFor(prefix: string): BoxelFrame | null {
  const addresses: number[] = [];
  for (const s of navRouteLog().systems) if (boxelIndexOf(s.name, prefix) != null) addresses.push(s.address);
  for (const f of flownOf?.(prefix) ?? []) addresses.push(f.address);
  for (const f of Object.values(lookupOf?.(prefix)?.systems ?? {})) if (f.id64 != null) addresses.push(f.id64);
  return frameOf(prefix, addresses);
}

/**
 * The predictions for a boxel listed up to `highest`, with what they stand on: the kind the seen positions show,
 * else the kind of its part of the galaxy, else the kind most of the boxels of its sector he has flown or plotted
 * show, else the likelier kind of a boxel this crowded. Null: nothing to show (the seen positions fit neither kind
 * well, or the guess is too close to a coin toss).
 */
function predictionsOf(
  frame: BoxelFrame,
  highest: number,
  seen: ReadonlyMap<number, Vec3>,
  notRolled: ReadonlySet<number>,
): Made | null {
  const read = boxelKindFrom(frame, seen, notRolled);
  let kind: BoxelKind;
  let exact: number;
  let neighbours = 0;
  if (read) {
    // Seen positions that mostly disagree with both kinds: a boxel the rules do not cover.
    if (read.hits < PLACEMENT_MIN_EXACT * read.checked) return null;
    kind = read.kind;
    exact = PLACEMENT_EXACT_KNOWN_KIND;
  } else {
    const middle = frame.cubeLy / 2;
    const likely = likelyBoxelKind(frame.code, highest, [
      frame.origin[0] + middle,
      frame.origin[1] + middle,
      frame.origin[2] + middle,
    ]);
    // Where the boxel's place does not settle it, the boxels round it can do better than its crowding (§3m): taken
    // when their measured share beats the crowding guess's for this boxel.
    const near = likely && likely.exact >= PLACEMENT_EXACT_KNOWN_KIND ? null : sectorKindOf(frame);
    const right = near
      ? SECTOR_VOTE_RIGHT[near.boxels === 1 ? "one" : near.boxels < 5 ? "few" : "many"][frame.code]
      : undefined;
    // A wrong kind leaves every system of an a or b boxel off, and about half of the others' (likelyBoxelKind).
    const fine = frame.code === "a" || frame.code === "b";
    const voted = right != null ? PLACEMENT_EXACT_KNOWN_KIND * (right + (fine ? 0 : (1 - right) / 2)) : null;
    if (near && voted != null && voted >= PLACEMENT_MIN_EXACT && (!likely || voted > likely.exact)) {
      kind = near.kind;
      exact = voted;
      neighbours = near.boxels;
    } else {
      if (!likely) return null;
      ({ kind, exact } = likely);
    }
  }
  const placed = predictBoxelPlacement(frame, highest, seen, kind, notRolled);
  return placed
    ? { guess: placed.positions, after: placed.after, exact, checked: read?.checked ?? 0, neighbours }
    : null;
}

/**
 * System number → position for the boxel `prefix` ("Eembaids EG-Y g"). The plotted routes win over Spansh, and both
 * over a prediction. `upTo`: the boxel's highest listed number; without it, or past {@link PREDICT_MAX_NUMBER},
 * nothing is predicted. `here`: where he is, a seen position when it is one of the boxel's systems.
 */
export function boxelPositionSet(
  prefix: string,
  upTo?: number,
  here?: { name: string; pos: Vec3 } | null,
): BoxelPositionSet {
  const positions = new Map<number, Vec3>();
  const addresses: number[] = [];
  for (const s of navRouteLog().systems) {
    const n = boxelIndexOf(s.name, prefix);
    if (n == null || !s.pos) continue;
    positions.set(n, s.pos);
    addresses.push(s.address);
  }
  for (const f of flownOf?.(prefix) ?? []) {
    if (!positions.has(f.n)) positions.set(f.n, f.pos);
    addresses.push(f.address);
  }
  for (const [k, f] of Object.entries(lookupOf?.(prefix)?.systems ?? {})) {
    const n = Number(k);
    if (!Number.isInteger(n)) continue;
    if (f.pos && !positions.has(n)) positions.set(n, f.pos);
    if (f.id64 != null) addresses.push(f.id64);
  }
  const at = here ? boxelIndexOf(here.name, prefix) : null;
  if (at != null && !positions.has(at)) positions.set(at, here!.pos);
  const frame = frameOf(prefix, addresses);
  // Catalogue stars: real positions, known without a visit; the dice do not place them.
  const notRolled = new Set<number>();
  if (frame) {
    for (const [n, p] of catalogueOf?.(frame.base) ?? []) {
      if (upTo != null && n > upTo) continue;
      notRolled.add(n);
      if (!positions.has(n)) positions.set(n, p);
    }
  }
  const predicted = new Set<number>();
  const none = { positions, predicted, exact: null, checked: 0, neighbours: 0, frame: null, after: null };
  if (upTo == null || !(upTo >= 0) || upTo > PREDICT_MAX_NUMBER) return none;
  if (!frame) return none;
  // The seen positions say the kind and steer the chain, so they are part of what a prediction stands on; so are the
  // boxels of the sector he has flown or plotted (they can give the kind).
  let seen = 0;
  for (const [n, p] of positions) seen = (seen * 31 + n + 1 + Math.round(p[0] * 32)) % 2147483647;
  const key = `${frame.base}|${upTo}|${positions.size}|${seen}|${notRolled.size}|${everywhereOf?.().size ?? 0}|${navRouteLog().systems.length}`;
  let made = memo.get(key);
  if (made === undefined) {
    made = predictionsOf(frame, upTo, positions, notRolled);
    memo.set(key, made);
    if (memo.size > 8) memo.delete(memo.keys().next().value!);
  }
  if (!made) return none;
  for (const [n, p] of made.guess) {
    if (positions.has(n)) continue;
    positions.set(n, p);
    predicted.add(n);
  }
  return {
    positions,
    predicted,
    exact: made.exact,
    checked: made.checked,
    neighbours: made.neighbours,
    frame,
    after: made.exact >= PLACEMENT_EXACT_KNOWN_KIND ? made.after : null,
  };
}

export function boxelPositions(
  prefix: string,
  upTo?: number,
  here?: { name: string; pos: Vec3 } | null,
): Map<number, Vec3> {
  return boxelPositionSet(prefix, upTo, here).positions;
}
