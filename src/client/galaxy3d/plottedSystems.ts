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
const listeners = new Set<() => void>();

export async function loadPlotted(): Promise<void> {
  try {
    const r = await fetch("/api/navroutes/plotted");
    if (!r.ok) return;
    const j = (await r.json()) as { systems: Row[] };
    list = j.systems.map(([address, name, starClass, x, y, z, e, routes, v]) => {
      const edsm = e === 0 ? undefined : e === 1;
      const visited = v === 1;
      return { address, name, starClass, x, y, z, edsm, routes, visited, tag: plottedTag({ visited, edsm }) };
    });
    byAddr = new Map(list.map((s) => [String(s.address), s]));
    for (const l of listeners) l();
  } catch {
    /* the next change reads it again */
  }
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
    return () => void listeners.delete(l);
  }, []);
  useEffect(() => {
    void loadPlotted();
  }, [rev]);
  return list;
}
