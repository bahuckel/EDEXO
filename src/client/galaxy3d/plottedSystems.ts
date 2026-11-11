/**
 * Every system on a route the commander plotted in the game (plan 1.3.3 R-2, `/api/navroutes/plotted`), for the
 * map's "Plotted systems" layer, its panel and the hover card: read when the map opens and again when the route
 * changes, kept here so the lookups need no props.
 */
import { useEffect, useState } from "react";
import { plottedTag } from "@shared/plottedTag.js";

export interface PlottedSystem {
  address: number;
  name: string;
  starClass: string;
  x: number;
  y: number;
  z: number;
  /** EDSM's answer: true it knows the system, false it does not, undefined not asked. */
  edsm: boolean | undefined;
  routes: number;
  visited: boolean;
  tag: string | null;
}

type Row = [number, string, string, number, number, number, 0 | 1 | 2, number, 0 | 1];

let byAddr = new Map<string, PlottedSystem>();
let list: PlottedSystem[] = [];
/** The server's revision of the list held here, and its count of visited systems then (review 2026-11-10 F3). */
let heldRev: number | null = null;
let heldVisited = 0;
const listeners = new Set<() => void>();

type Answer =
  | { rev: number; visitedCount: number; unchanged: true }
  | { rev: number; visitedCount: number; visited: number[] }
  | { rev: number; visitedCount: number; systems: Row[] };

export async function loadPlotted(): Promise<void> {
  try {
    const q = heldRev === null ? "" : `?since=${heldRev}&visited=${heldVisited}`;
    const r = await fetch(`/api/navroutes/plotted${q}`);
    if (!r.ok) return;
    const j = (await r.json()) as Answer;
    if ("unchanged" in j) return;
    if ("visited" in j) {
      // The same list, more of it visited: only the flags move.
      const seen = new Set(j.visited);
      list = list.map((s) => {
        const visited = seen.has(s.address);
        return visited === s.visited ? s : { ...s, visited, tag: plottedTag({ visited, edsm: s.edsm }) };
      });
    } else {
      list = j.systems.map(([address, name, starClass, x, y, z, e, routes, v]) => {
        const edsm = e === 0 ? undefined : e === 1;
        const visited = v === 1;
        return { address, name, starClass, x, y, z, edsm, routes, visited, tag: plottedTag({ visited, edsm }) };
      });
    }
    heldRev = j.rev;
    heldVisited = j.visitedCount;
    byAddr = new Map(list.map((s) => [String(s.address), s]));
    for (const l of listeners) l();
  } catch {
    /* the next change reads it again */
  }
}

/** Nothing shows the list any more (the map's tab released): its systems go, and the next open reads them again. */
function release(): void {
  list = [];
  byAddr = new Map();
  heldRev = null;
  heldVisited = 0;
}

/** A plotted system by its address (a marker's id). */
export function plottedByAddr(id: string): PlottedSystem | null {
  return byAddr.get(id) ?? null;
}

/** The plotted systems, re-read whenever `rev` moves (a new route, a jump). */
export function usePlotted(rev: string): PlottedSystem[] {
  const [, tick] = useState(0);
  useEffect(() => {
    const l = () => tick((n) => n + 1);
    listeners.add(l);
    return () => {
      listeners.delete(l);
      if (listeners.size === 0) release();
    };
  }, []);
  useEffect(() => {
    void loadPlotted();
  }, [rev]);
  return list;
}
