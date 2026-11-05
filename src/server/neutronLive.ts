/**
 * A neutron route being flown (plan 8.5, owner 2026-10-13): after each jump that lands on one of the route's stops,
 * the next stop goes to the clipboard (the boxel run's delivery, F6 copies it again), and the HUD's Next jump card
 * says what to do where the ship is: scoop here, supercharge here, or scoop a star on the way.
 *
 * Started from the galaxy map's Neutron tab ("Fly this route") with the plan's stops, kept in
 * `edexo-neutron-live.json` so a long trip survives a restart, and ended by "Stop", by arriving at the last stop, or
 * by starting a boxel run (the clipboard has one owner at a time).
 *
 * The game plots the normal jumps between two stops itself, so a jump into a system that is not a stop changes
 * nothing: the stop on the clipboard is still the one to fly to — while the ship stays near the way there. Once it
 * is well off it ({@link NeutronLive.offRoute}), the route is planned again from where the ship is to the
 * destinations not reached yet (owner, 2026-10-13: "always taking into consideration your current location").
 */
import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import type { NeutronLiveDTO } from "../shared/dto/neutron.js";
import { routeProgress } from "../shared/routeProgress.js";

export type { NeutronLiveDTO };

export interface LiveHop {
  name: string;
  x: number;
  y: number;
  z: number;
  kind: "start" | "neutron" | "waypoint";
  /** Jumps from the stop before, and whether the first of them is supercharged. */
  jumps: number;
  boosted: number;
  /** Scoop this system's own star here (ls from arrival); to half a tank only, when `refuelHalf`. */
  refuel: boolean;
  refuelHalf?: boolean;
  scoopLs: number | null;
  /** The normal jumps before this stop need a scoopable star on the way. */
  scoopOnWay: boolean;
  /** "Use Jumponium": the FSD injections planned for the normal jumps to this stop (one jump fewer). */
  inject?: { tier: "basic" | "standard" | "premium"; count: number } | null;
  /** The plan's fuel here in jumps, on arrival and on leaving (neutronRoute.ts NeutronHop); absent in older routes. */
  fuelArrive?: number;
  fuelLeave?: number;
  /**
   * The plan's jumps of fuel left and the FSD's health there, and the system's address: shown in the Neutron drawer's
   * list of the stops ahead (review 2026-11-05: after a re-plot it had lost them). Absent on Spansh and older routes.
   */
  jumpsLeft?: number;
  fsdHealth?: number;
  address?: number;
}

/** The commander's own stops (not the neutron stars between) and the ship the route was planned for. */
export interface LivePlan {
  targets: { name: string; x: number; y: number; z: number }[];
  rangeLy: number;
  /** Planned with FSD injections: a re-plot from where the ship went keeps them. */
  useJumponium?: boolean;
  /** Planned with refuels to half a tank: a re-plot keeps them. */
  halfTank?: boolean;
  /** The share of the tank kept as a reserve (neutronRoute.ts `reserve`): a re-plot keeps it. */
  reserve?: number;
  /** The supercharge it was planned with (×4 / ×6), kept by a re-plot; absent: the ship's own. */
  boost?: number;
}

/** Whose jumps move the route on: the ship's (FSDJump), or the commander's fleet carrier's (a Spansh carrier route). */
export type LiveFollow = "ship" | "carrier";

export interface NeutronLive {
  start(hops: LiveHop[], here: Here, plan?: LivePlan | null, follow?: LiveFollow): string | null;
  /** Whose jumps the route follows; null with no route. */
  follows(): LiveFollow | null;
  /** The destinations not reached yet and the plan's ship, for planning again from here; null without a plan. */
  remaining(): LivePlan | null;
  /** The ship is far off the way from the stop reached to the next (more than twice its range, 100 ly at least). */
  offRoute(here: Here): boolean;
  /**
   * A new plan from where the ship is (hops[0] = here) to `targets`: the next stop is copied, unless it is the one
   * already on the clipboard (a re-plot for the fuel often keeps it).
   */
  replace(hops: LiveHop[], targets: LivePlan["targets"]): string | null;
  /** Planning again from here is under way (the HUD says so), and why, when it is not the ship leaving the route. */
  setReplanning(on: boolean, why?: string | null): void;
  /** The stop reached last, the one after, and whether the ship is in that stop's system; null with no route. */
  position(here: Here): { at: number; hop: LiveHop; next: LiveHop | null; onStop: boolean } | null;
  /** Bumped with every new route, for the galaxy map to draw the new one. */
  version(): number;
  stop(): void;
  active(): boolean;
  /** The route being flown, for the drawer to show and the map to draw again. */
  hops(): LiveHop[] | null;
  /** Copies the next stop again (F6). */
  copyNext(): string | null;
  /** An FSDJump landed here: copies the next stop when this is a stop of the route. */
  onJump(here: Here): string | null;
  view(here: Here): NeutronLiveDTO | null;
}

export type Here = { name: string | null; pos: { x: number; y: number; z: number } | null };

type Pt = { x: number; y: number; z: number };
/** How far p is from the segment a → b (ly). */
function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const ab = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
  const len2 = ab.x * ab.x + ab.y * ab.y + ab.z * ab.z;
  const t =
    len2 > 0
      ? Math.max(0, Math.min(1, ((p.x - a.x) * ab.x + (p.y - a.y) * ab.y + (p.z - a.z) * ab.z) / len2))
      : 0;
  return Math.hypot(p.x - (a.x + t * ab.x), p.y - (a.y + t * ab.y), p.z - (a.z + t * ab.z));
}

function parseTargets(raw: unknown): LivePlan["targets"] {
  if (!Array.isArray(raw)) return [];
  const out: LivePlan["targets"] = [];
  const ok = (v: unknown) => typeof v === "number" && Number.isFinite(v);
  for (const r of raw.slice(0, 20) as Record<string, unknown>[]) {
    if (!r || !ok(r.x) || !ok(r.y) || !ok(r.z)) continue;
    out.push({
      name: String(r.name ?? "Stop").slice(0, 80),
      x: r.x as number,
      y: r.y as number,
      z: r.z as number,
    });
  }
  return out;
}

/** A plan a client sent: its destinations and range; null when it is not one. */
export function parseLivePlan(raw: unknown): LivePlan | null {
  const r = raw as Record<string, unknown> | null;
  if (!r || typeof r !== "object") return null;
  const targets = parseTargets(r.targets);
  const rangeLy = typeof r.rangeLy === "number" && r.rangeLy >= 5 && r.rangeLy <= 500 ? r.rangeLy : null;
  const boost = r.boost === 4 || r.boost === 6 ? r.boost : undefined;
  const reserve = typeof r.reserve === "number" && r.reserve > 0 && r.reserve <= 0.5 ? r.reserve : undefined;
  return targets.length && rangeLy
    ? {
        targets,
        rangeLy,
        useJumponium: r.useJumponium === true,
        ...(r.halfTank === true ? { halfTank: true } : {}),
        ...(boost ? { boost } : {}),
        ...(reserve ? { reserve } : {}),
      }
    : null;
}

const MAX_HOPS = 5000;
/** Stops come from the neutron index at 1/32 ly; a system's StarPos is exact to 1/32 too. */
const SAME_PLACE_LY = 0.1;

const sameSystem = (h: LiveHop, here: Here): boolean => {
  if (here.name && h.name.toLowerCase() === here.name.toLowerCase()) return true;
  const p = here.pos;
  return (
    !!p &&
    Math.abs(p.x - h.x) < SAME_PLACE_LY &&
    Math.abs(p.y - h.y) < SAME_PLACE_LY &&
    Math.abs(p.z - h.z) < SAME_PLACE_LY
  );
};

function parseInject(v: unknown): LiveHop["inject"] {
  const o = v as { tier?: unknown; count?: unknown } | null;
  if (!o || typeof o !== "object") return null;
  const tier = o.tier === "basic" || o.tier === "standard" || o.tier === "premium" ? o.tier : null;
  const count = typeof o.count === "number" && Number.isFinite(o.count) ? Math.round(o.count) : 0;
  return tier && count >= 1 && count <= 99 ? { tier, count } : null;
}

/** The stops a client sent, checked; null when they are not a route. */
export function parseLiveHops(raw: unknown): LiveHop[] | null {
  if (!Array.isArray(raw) || raw.length < 2 || raw.length > MAX_HOPS) return null;
  const out: LiveHop[] = [];
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  for (const r of raw as Record<string, unknown>[]) {
    if (!r || typeof r !== "object") return null;
    const x = num(r.x);
    const y = num(r.y);
    const z = num(r.z);
    const name = typeof r.name === "string" ? r.name.trim().slice(0, 80) : "";
    if (x == null || y == null || z == null || !name) return null;
    const kind = r.kind === "start" || r.kind === "neutron" || r.kind === "waypoint" ? r.kind : "waypoint";
    const fuelArrive = num(r.fuelArrive);
    const fuelLeave = num(r.fuelLeave);
    const jumpsLeft = num(r.jumpsLeft);
    const fsdHealth = num(r.fsdHealth);
    const address = num(r.address);
    out.push({
      name,
      x,
      y,
      z,
      kind,
      jumps: Math.max(0, Math.round(num(r.jumps) ?? 0)),
      boosted: num(r.boosted) ? 1 : 0,
      refuel: r.refuel === true,
      ...(r.refuelHalf === true ? { refuelHalf: true } : {}),
      scoopLs: num(r.scoopLs),
      scoopOnWay: r.scoopOnWay === true,
      inject: parseInject(r.inject),
      ...(fuelArrive != null && fuelArrive >= 0 && fuelLeave != null && fuelLeave >= 0 ? { fuelArrive, fuelLeave } : {}),
      ...(jumpsLeft != null && jumpsLeft >= 0 ? { jumpsLeft } : {}),
      ...(fsdHealth != null && fsdHealth >= 0 && fsdHealth <= 1 ? { fsdHealth } : {}),
      ...(address != null && Number.isSafeInteger(address) && address > 0 ? { address } : {}),
    });
  }
  return out;
}

export function createNeutronLive(opts: {
  filePath: string | null;
  deliver: (name: string) => void;
  /** Called when a route starts: the boxel run ends (one owner of the clipboard). */
  onStart?: () => void;
  /** The last stop reached: what the route put on the HUD goes, as with Stop. */
  onDone?: () => void;
  now?: () => string;
  /** Where the commander's carrier is, for a carrier route's view (plan 1.3.6). */
  carrierHere?: () => Here;
}): NeutronLive {
  const now = opts.now ?? (() => new Date().toISOString());
  let st = load(opts.filePath);
  let done: { destination: string; carrier?: boolean } | null = null;
  let replanning = false;
  let replanWhy: string | null = null;
  let version = 1;

  const persist = (): void => {
    if (!opts.filePath) return;
    try {
      if (!st) {
        if (existsSync(opts.filePath)) unlinkSync(opts.filePath);
        return;
      }
      const tmp = `${opts.filePath}.tmp`;
      writeFileSync(tmp, `${JSON.stringify({ formatVersion: 1, ...st })}\n`, "utf8");
      renameSync(tmp, opts.filePath);
    } catch {
      /* kept in memory; the next change tries again */
    }
  };

  const copyNext = (): string | null => {
    const next = st?.hops[st.at + 1];
    if (!next) return null;
    opts.deliver(next.name);
    return next.name;
  };

  return {
    start(hops, here, plan, follow) {
      opts.onStart?.();
      done = null;
      // Where the ship is on the route: the last stop it is in (a re-plan from mid-route), else the start.
      let at = 0;
      for (let i = hops.length - 2; i >= 0; i--)
        if (sameSystem(hops[i]!, here)) {
          at = i;
          break;
        }
      st = { hops, at, startedAt: now(), plan: plan ?? null, ...(follow === "carrier" ? { follow: "carrier" as const } : {}) };
      // A re-plot of the route before is not this route's: it neither shows nor lands here (version below).
      replanning = false;
      replanWhy = null;
      version++;
      persist();
      return copyNext();
    },
    remaining() {
      if (!st?.plan) return null;
      // Each destination ends a leg with a "waypoint" hop; those at or before the stop reached are behind.
      const passed = st.hops.slice(1, st.at + 1).filter((h) => h.kind === "waypoint").length;
      const targets = st.plan.targets.slice(passed);
      return targets.length
        ? {
            targets,
            rangeLy: st.plan.rangeLy,
            useJumponium: st.plan.useJumponium === true,
            ...(st.plan.halfTank ? { halfTank: true } : {}),
            ...(st.plan.boost ? { boost: st.plan.boost } : {}),
            ...(st.plan.reserve ? { reserve: st.plan.reserve } : {}),
          }
        : null;
    },
    offRoute(here) {
      if (!st || !here.pos || replanning) return false;
      const cur = st.hops[st.at]!;
      const next = st.hops[st.at + 1];
      if (!next || sameSystem(cur, here)) return false;
      const r = st.plan?.rangeLy ?? 50;
      return distToSegment(here.pos, cur, next) > Math.max(2 * r, 100);
    },
    replace(hops, targets) {
      if (!st) return null;
      const was = st.hops[st.at + 1]?.name ?? null;
      st = { ...st, hops, at: 0, plan: st.plan ? { ...st.plan, targets } : null };
      version++;
      persist();
      const next = hops[1]?.name ?? null;
      return next != null && next === was ? next : copyNext();
    },
    setReplanning(on, why = null) {
      replanning = on;
      replanWhy = on ? why : null;
    },
    position(here) {
      if (!st) return null;
      const hop = st.hops[st.at]!;
      return { at: st.at, hop, next: st.hops[st.at + 1] ?? null, onStop: sameSystem(hop, here) };
    },
    version: () => version,
    stop() {
      st = null;
      done = null;
      replanning = false;
      replanWhy = null;
      version++;
      persist();
    },
    active: () => st != null,
    follows: () => (st ? (st.follow ?? "ship") : null),
    hops: () => st?.hops ?? null,
    copyNext,
    onJump(here) {
      done = null;
      if (!st) return null;
      // The first stop after the one reached that this system is (a stop skipped by a longer plot still counts).
      let hit = -1;
      for (let i = st.at + 1; i < st.hops.length; i++)
        if (sameSystem(st.hops[i]!, here)) {
          hit = i;
          break;
        }
      if (hit < 0) return null;
      if (hit === st.hops.length - 1) {
        done = { destination: st.hops[hit]!.name, ...(st.follow === "carrier" ? { carrier: true } : {}) };
        st = null;
        // A new version: the galaxy map clears the line (review 1.2.16: it stayed after arrival).
        version++;
        persist();
        opts.onDone?.();
        return null;
      }
      st.at = hit;
      persist();
      return copyNext();
    },
    view(shipHere) {
      const carrier = st?.follow === "carrier" || (!st && done?.carrier === true);
      const here = carrier ? (opts.carrierHere?.() ?? shipHere) : shipHere;
      if (!st) {
        if (!done) return null;
        return {
          at: 0,
          total: 0,
          next: null,
          nextJumps: 0,
          nextBoosted: false,
          onStop: true,
          refuelHere: false,
          refuelHalf: false,
          scoopLs: null,
          superchargeHere: false,
          scoopOnWay: false,
          nextInject: null,
          done: true,
          replanning: false,
          destination: done.destination,
          ...(carrier ? { carrier: true } : {}),
        };
      }
      const cur = st.hops[st.at]!;
      const next = st.hops[st.at + 1] ?? null;
      const onStop = sameSystem(cur, here);
      return {
        at: st.at,
        total: st.hops.length - 1,
        next: next?.name ?? null,
        nextJumps: next?.jumps ?? 0,
        nextBoosted: !!next?.boosted,
        nextInject: next?.inject ?? null,
        onStop,
        refuelHere: onStop && cur.refuel,
        refuelHalf: onStop && cur.refuel && cur.refuelHalf === true,
        scoopLs: onStop && cur.refuel ? cur.scoopLs : null,
        superchargeHere: onStop && !!next?.boosted,
        scoopOnWay: !!next?.scoopOnWay,
        done: false,
        replanning,
        ...(replanning && replanWhy ? { replanWhy } : {}),
        destination: st.hops[st.hops.length - 1]!.name,
        ...(carrier ? { carrier: true } : {}),
        ...(!carrier && !st.hops.some((h) => h.kind === "neutron") ? { noNeutrons: true } : {}),
        progress: routeProgress(st.hops, st.at),
      };
    },
  };
}

function load(
  filePath: string | null,
): { hops: LiveHop[]; at: number; startedAt: string; plan: LivePlan | null; follow?: "carrier" } | null {
  if (!filePath || !existsSync(filePath)) return null;
  try {
    const raw = JSON.parse(readFileSync(filePath, "utf8")) as {
      hops?: unknown;
      at?: unknown;
      startedAt?: unknown;
      plan?: unknown;
      follow?: unknown;
    };
    const hops = parseLiveHops(raw.hops);
    if (!hops) return null;
    const at =
      typeof raw.at === "number" && Number.isInteger(raw.at)
        ? Math.max(0, Math.min(hops.length - 2, raw.at))
        : 0;
    return {
      hops,
      at,
      startedAt: typeof raw.startedAt === "string" ? raw.startedAt : "",
      plan: parseLivePlan(raw.plan),
      ...(raw.follow === "carrier" ? { follow: "carrier" as const } : {}),
    };
  } catch {
    return null;
  }
}
