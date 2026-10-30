/**
 * The route's systems valued (plan 1.3.3 R-1 / R-3, owner 2026-10-30: "values for FSS and DSS of entire systems
 * added to the planned route (if discovered)"): each one's FSS, DSS and expected exobiology from Spansh
 * (`/api/route/system-values`), read in the background one system at a time while a route list is open, and kept for
 * the session so another list (the NavRoute finder, the neutron drawer) does not ask again.
 */
import { useEffect, useState } from "react";
import type { RouteSystemValuesDTO } from "@shared/dto/routeSystem.js";
import { fmtCrShort } from "@shared/format";

/** Between two systems (ms): Spansh's server is a volunteer's; the server asks one at a time as well. */
const GAP_MS = 250;

const known = new Map<number, RouteSystemValuesDTO>();
/** Asked and not answered (Spansh down, the journals still loading): counted as read, asked again next time. */
const failed = new Set<number>();
const listeners = new Set<() => void>();
let queue: { addr: number; name: string }[] = [];
let running = false;

async function work(): Promise<void> {
  if (running) return;
  running = true;
  try {
    while (queue.length) {
      const next = queue.shift()!;
      if (known.has(next.addr)) continue;
      try {
        const r = await fetch(`/api/route/system-values?addr=${next.addr}&name=${encodeURIComponent(next.name)}`);
        const v = r.ok ? ((await r.json()) as RouteSystemValuesDTO) : null;
        // An error is not kept for the session: a timeout or a 429 now is an answer later.
        if (v && v.state !== "error") known.set(next.addr, v);
        else failed.add(next.addr);
      } catch {
        failed.add(next.addr);
      }
      for (const l of listeners) l();
      await new Promise((res) => setTimeout(res, GAP_MS));
    }
  } finally {
    running = false;
  }
}

/** Ask for these systems, in their order, ahead of anything asked before. */
function want(systems: readonly { addr: number; name: string }[]): void {
  for (const s of systems) failed.delete(s.addr);
  const fresh = systems.filter((s) => !known.has(s.addr));
  const ids = new Set(fresh.map((s) => s.addr));
  queue = [...fresh, ...queue.filter((s) => !ids.has(s.addr))];
  void work();
}

/** One system's values (null until read). */
export function routeValueOf(addr: number): RouteSystemValuesDTO | null {
  return known.get(addr) ?? null;
}

/**
 * Values for a route's systems while `on`: the map of what has been read, and how many of them. Re-renders as each
 * one arrives.
 */
export function useRouteValues(
  systems: readonly { addr: number; name: string }[],
  on: boolean,
): { values: Map<number, RouteSystemValuesDTO>; read: number } {
  const [, tick] = useState(0);
  const key = systems.map((s) => s.addr).join(",");
  useEffect(() => {
    if (!on || !systems.length) return;
    const l = () => tick((n) => n + 1);
    listeners.add(l);
    want(systems);
    return () => {
      listeners.delete(l);
      // A list closed: the systems only it wanted are not asked for.
      const ids = new Set(systems.map((s) => s.addr));
      queue = queue.filter((s) => !ids.has(s.addr));
    };
    // `key` stands for `systems`: a new array each render with the same systems must not ask again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, on]);
  const values = new Map<number, RouteSystemValuesDTO>();
  let read = 0;
  for (const s of systems) {
    const v = known.get(s.addr);
    if (v) values.set(s.addr, v);
    if (v || failed.has(s.addr)) read++;
  }
  return { values, read };
}

/** The route's totals over the systems read: FSS, DSS of the worthwhile planets, expected exobiology. */
export function routeTotals(values: Iterable<RouteSystemValuesDTO>): { fss: number; dss: number; bio: number; missing: number; known: number } {
  const t = { fss: 0, dss: 0, bio: 0, missing: 0, known: 0 };
  for (const v of values) {
    if (v.state !== "ok") continue;
    t.known++;
    t.fss += v.fssCr;
    t.dss += v.dssCr;
    t.bio += v.bioCr;
    t.missing += v.missing;
  }
  return t;
}

/** A route system's worth in a line (plan 1.3.3 R-3): mapping the worthwhile planets, the biology, the bodies missing. */
export function routeValueLine(v: RouteSystemValuesDTO | null | undefined): string | null {
  if (!v) return null;
  if (v.state === "none") return "not on Spansh: nobody reported it";
  if (v.state === "error") return null;
  const parts = [`scan ${fmtCrShort(v.fssCr)}`];
  if (v.dssBodies) parts.push(`map ${fmtCrShort(v.dssCr)} (${v.dssBodies})`);
  if (v.bioCr) parts.push(`bio ${fmtCrShort(v.bioCr)}`);
  if (v.missing) parts.push(`${v.missing} missing`);
  return parts.join(" · ");
}
