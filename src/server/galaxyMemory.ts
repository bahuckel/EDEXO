/**
 * The galaxy map's memory is let go when nobody is using the map (owner, 2026-09-28: the map opens in
 * its own window, loaded fresh every time, "so resource usage is lower").
 *
 * Opening the map pulls the 245 MB bio index into the server, plus the 40 MB overview buffer and the
 * tile index built from it. None of that is needed by the rest of the app, so every galaxy request
 * touches this clock, and after `idleMs` without one each registered cache is cleared and the
 * garbage collector can have it. The next request rebuilds what it needs (about half a second).
 */

import { collectGarbageSoon } from "./collectGarbage.js";

type Release = () => void;

const releases = new Map<string, Release>();
let timer: ReturnType<typeof setTimeout> | null = null;
let lastTouch = 0;
let releasedCount = 0;

/**
 * Default two minutes (owner, 2026-10-26: was five; the map held ~360 MB in the server for five minutes after it
 * closed, and opening it again after the release costs a second or two). `EDEXO_GALAXY_IDLE_MS` overrides it (tests,
 * and anyone who wants it held).
 */
function idleMs(): number {
  const v = Number(process.env.EDEXO_GALAXY_IDLE_MS);
  return Number.isFinite(v) && v > 0 ? v : 2 * 60_000;
}

export function registerGalaxyCache(name: string, release: Release): void {
  releases.set(name, release);
}

/** Every galaxy-map request calls this. */
export function touchGalaxyMemory(now = Date.now()): void {
  lastTouch = now;
  if (timer) clearTimeout(timer);
  timer = setTimeout(releaseGalaxyMemory, idleMs());
  // Never the reason a process stays alive (a CLI run, a test).
  (timer as { unref?: () => void }).unref?.();
}

export function releaseGalaxyMemory(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  for (const release of releases.values()) release();
  releasedCount++;
  // Freed now, not when V8's idle reducer gets to it (collectGarbage.ts).
  collectGarbageSoon();
}

/** For the perf log, Copy diagnostics and tests. `held`: touched and not let go since. */
export function galaxyMemoryState(): {
  lastTouch: number;
  releasedCount: number;
  caches: string[];
  held: boolean;
  idleMs: number;
} {
  return { lastTouch, releasedCount, caches: [...releases.keys()], held: timer !== null, idleMs: idleMs() };
}
