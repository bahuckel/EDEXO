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
 * nothing: the stop on the clipboard is still the one to fly to.
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
}

export interface NeutronLive {
  start(hops: LiveHop[], here: Here): string | null;
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
    });
  }
  return out;
}

export function createNeutronLive(opts: {
  filePath: string | null;
  deliver: (name: string) => void;
  /** Called when a route starts: the boxel run ends (one owner of the clipboard). */
  onStart?: () => void;
  now?: () => string;
}): NeutronLive {
  const now = opts.now ?? (() => new Date().toISOString());
  let st = load(opts.filePath);
  let done: { destination: string } | null = null;

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
    start(hops, here) {
      opts.onStart?.();
      done = null;
      // Where the ship is on the route: the last stop it is in (a re-plan from mid-route), else the start.
      let at = 0;
      for (let i = hops.length - 2; i >= 0; i--)
        if (sameSystem(hops[i]!, here)) {
          at = i;
          break;
        }
      st = { hops, at, startedAt: now() };
      persist();
      return copyNext();
    },
    stop() {
      st = null;
      done = null;
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
        persist();
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
          done: true,
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
        onStop,
        refuelHere: onStop && cur.refuel,
        scoopLs: onStop && cur.refuel ? cur.scoopLs : null,
        superchargeHere: onStop && !!next?.boosted,
        scoopOnWay: !!next?.scoopOnWay,
        done: false,
        destination: st.hops[st.hops.length - 1]!.name,
      };
    },
  };
}

function load(filePath: string | null): { hops: LiveHop[]; at: number; startedAt: string } | null {
  if (!filePath || !existsSync(filePath)) return null;
  try {
    const raw = JSON.parse(readFileSync(filePath, "utf8")) as {
      hops?: unknown;
      at?: unknown;
      startedAt?: unknown;
    };
    const hops = parseLiveHops(raw.hops);
    if (!hops) return null;
    const at =
      typeof raw.at === "number" && Number.isInteger(raw.at)
        ? Math.max(0, Math.min(hops.length - 2, raw.at))
        : 0;
    return { hops, at, startedAt: typeof raw.startedAt === "string" ? raw.startedAt : "" };
  } catch {
    return null;
  }
}
