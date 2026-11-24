/*
  Spansh for a whole-galaxy hunt's nearest boxels (plan-1.4.0 §6.2; owner 2026-11-24: "nearest 20, cached", a boxel
  where the target is already known "rank lower, show"). The local tables rank every g and h boxel of the galaxy on
  estimates; the nearest 20 the hunt lists are then looked up one at a time with the Boxels screen's own Spansh look-up
  (server/boxelLookup.ts: a page every five seconds, kept 30 days in edexo-boxel-lookups.json), which gives how many of
  the boxel's systems are known and what they hold. A newer hunt replaces the queue; nothing blocks a request.
*/
import type { BoxelLookupRecord, BoxelLookupService } from "./boxelLookup.js";
import { LOOKUP_GAP_MS, starLabel } from "./boxelLookup.js";
import type { ExpeditionTarget } from "./expeditionTargets.js";

/**
 * The last whole-galaxy hunt the galaxy map's drawer ran for bodies or stars (its target and the codes asked for),
 * for the HUD's line (owner 2026-11-24: "HUD your way"). This session only.
 */
let lastHunt: { target: string; codes: string | null } | null = null;

export function rememberHunt(target: string, codes: string | null): void {
  lastHunt = { target, codes };
}

export function lastGalaxyHunt(): { target: string; codes: string | null } | null {
  return lastHunt;
}

/** Boxels looked up per hunt: the nearest of the listed ones not looked up in the last 30 days. */
export const HUNT_LOOKUPS = 20;
/** How often the runner checks whether the look-up it started has finished. */
const POLL_MS = 1_000;

let service: BoxelLookupService | null = null;
let queue: string[] = [];
let running = false;
let revision = 0;
let done = 0;
/** The hunt the queue was made for: the same one asked again (the drawer polls while it runs) leaves it be. */
let queuedFor = "";

/** The Boxels screen's look-up service, set where it is made (routes/boxelRoutes.ts). */
export function setGalaxyHuntLookupService(s: BoxelLookupService | null): void {
  service = s;
}

/** A finished look-up of the boxel — every Spansh page read, or EDSM's list when Spansh was down — or null. */
export function huntLookupFor(prefix: string): BoxelLookupRecord | null {
  const r = service?.get(prefix) ?? null;
  return r?.complete || r?.source === "edsm" ? r : null;
}

/** Moves each time a look-up finishes, so a cached hunt is scored again with it. */
export function huntLookupRevision(): number {
  return revision;
}

export function huntLookupState(): { queued: number; done: number } {
  return { queued: queue.length + (running ? 1 : 0), done };
}

/** Looks up these boxels (nearest first), the ones without a fresh look-up, in place of any still waiting. */
export function queueHuntLookups(prefixes: readonly string[]): void {
  if (!service) return;
  const nearest = prefixes.slice(0, HUNT_LOOKUPS);
  const key = nearest.join("|");
  if (key === queuedFor) return;
  queuedFor = key;
  queue = nearest.filter((p) => !service!.get(p));
  done = 0;
  if (!running) void run();
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function run(): Promise<void> {
  running = true;
  try {
    while (queue.length && service) {
      // The Boxels screen may be looking one up: its turn first.
      while (service.status()?.running) await wait(POLL_MS);
      const prefix = queue.shift()!;
      if (service.get(prefix) || !service.start(prefix)) continue;
      await wait(POLL_MS);
      while (service.status()?.running) await wait(POLL_MS);
      done++;
      revision++;
      if (queue.length) await wait(LOOKUP_GAP_MS);
    }
  } finally {
    running = false;
  }
}

/**
 * How many of a look-up's systems already hold the target: its main star for a star (the whole kind when the name
 * is a family, "Wolf-Rayet"), the planet for an Earth-like, water or ammonia world or a helium-rich gas giant. Null
 * for what a look-up cannot tell (gas giants counted, system worth).
 */
export function knownTargetsIn(record: BoxelLookupRecord, target: ExpeditionTarget): number | null {
  const systems = Object.values(record.systems);
  if (target.kind === "star") {
    const want = starLabel(target.star).toLowerCase();
    const family = !/^[obafgkmlty]$/.test(want);
    return systems.filter((s) => {
      const m = (s.mainStar ?? "").toLowerCase();
      return m === want || (family && m.startsWith(want));
    }).length;
  }
  if (target.kind === "body") {
    if (target.body === "gg") return null;
    if (target.body === "hrgg") return systems.filter((s) => s.notables.some((n) => n.kind === "helium")).length;
    return systems.filter((s) => s.bodyTypes.includes(target.body)).length;
  }
  return null;
}
