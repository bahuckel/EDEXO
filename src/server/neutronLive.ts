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
  /** Scoop this system's own star here (ls from arrival). */
  refuel: boolean;
  scoopLs: number | null;
  /** The normal jumps before this stop need a scoopable star on the way. */
  scoopOnWay: boolean;
  /** "Use Jumponium": the FSD injections planned for the normal jumps to this stop (one jump fewer). */
  inject?: { tier: "basic" | "standard" | "premium"; count: number } | null;
}

/** The commander's own stops (not the neutron stars between) and the ship the route was planned for. */
export interface LivePlan {
  targets: { name: string; x: number; y: number; z: number }[];
  rangeLy: number;
  /** Planned with FSD injections: a re-plot from where the ship went keeps them. */
  useJumponium?: boolean;
  /** The supercharge it was planned with (×4 / ×6), kept by a re-plot; absent: the ship's own. */
  boost?: number;
}

export interface NeutronLive {
  start(hops: LiveHop[], here: Here, plan?: LivePlan | null): string | null;
  /** The destinations not reached yet and the plan's ship, for planning again from here; null without a plan. */
  remaining(): LivePlan | null;
  /** The ship is far off the way from the stop reached to the next (more than twice its range, 100 ly at least). */
  offRoute(here: Here): boolean;
  /** A new plan from where the ship is (hops[0] = here) to `targets`: the next stop is copied. */
  replace(hops: LiveHop[], targets: LivePlan["targets"]): string | null;
  /** Planning again from here is under way (the HUD says so). */
  setReplanning(on: boolean): void;
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
  return targets.length && rangeLy
    ? { targets, rangeLy, useJumponium: r.useJumponium === true, ...(boost ? { boost } : {}) }
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
    out.push({
      name,
      x,
      y,
      z,
      kind,
      jumps: Math.max(0, Math.round(num(r.jumps) ?? 0)),
      boosted: num(r.boosted) ? 1 : 0,
      refuel: r.refuel === true,
      scoopLs: num(r.scoopLs),
      scoopOnWay: r.scoopOnWay === true,
      inject: parseInject(r.inject),
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
}): NeutronLive {
  const now = opts.now ?? (() => new Date().toISOString());
  let st = load(opts.filePath);
  let done: { destination: string } | null = null;
  let replanning = false;
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
    start(hops, here, plan) {
      opts.onStart?.();
      done = null;
      // Where the ship is on the route: the last stop it is in (a re-plan from mid-route), else the start.
      let at = 0;
      for (let i = hops.length - 2; i >= 0; i--)
        if (sameSystem(hops[i]!, here)) {
          at = i;
          break;
        }
      st = { hops, at, startedAt: now(), plan: plan ?? null };
      // A re-plot of the route before is not this route's: it neither shows nor lands here (version below).
      replanning = false;
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
            ...(st.plan.boost ? { boost: st.plan.boost } : {}),
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
      st = { hops, at: 0, startedAt: st.startedAt, plan: st.plan ? { ...st.plan, targets } : null };
      version++;
      persist();
      return copyNext();
    },
    setReplanning(on) {
      replanning = on;
    },
    version: () => version,
    stop() {
      st = null;
      done = null;
      replanning = false;
      version++;
      persist();
    },
    active: () => st != null,
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
        done = { destination: st.hops[hit]!.name };
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
    view(here) {
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
          scoopLs: null,
          superchargeHere: false,
          scoopOnWay: false,
          nextInject: null,
          done: true,
          replanning: false,
          destination: done.destination,
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
        scoopLs: onStop && cur.refuel ? cur.scoopLs : null,
        superchargeHere: onStop && !!next?.boosted,
        scoopOnWay: !!next?.scoopOnWay,
        done: false,
        replanning,
        destination: st.hops[st.hops.length - 1]!.name,
      };
    },
  };
}

function load(
  filePath: string | null,
): { hops: LiveHop[]; at: number; startedAt: string; plan: LivePlan | null } | null {
  if (!filePath || !existsSync(filePath)) return null;
  try {
    const raw = JSON.parse(readFileSync(filePath, "utf8")) as {
      hops?: unknown;
      at?: unknown;
      startedAt?: unknown;
      plan?: unknown;
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
    };
  } catch {
    return null;
  }
}
