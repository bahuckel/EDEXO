/**
 * Any system as a stop of the neutron route (plan 1.3.4 S-4, owner 2026-10-31: "all systems should be a viable
 * drop-off not just systems with stations, even Spansh/EDSM found systems, and those from journal"). A stop that came
 * with a name and a place only (a station's system, the ship's own, a stop kept from an older build) gets its system
 * address here, so its worth shows in the drawer like any other: from the journals' systems and the game's visited
 * list, the plotted routes, the galaxy index, then Spansh's and EDSM's name search. A hit counts only within
 * {@link NEAR_LY} of the stop's place (another system with the same name is not it).
 */
import type { GameStateStore } from "./gameState.js";
import type { TileIndex } from "./galaxyTiles.js";
import { galaxyFind } from "./galaxyFind.js";
import { findPlottedSystems } from "./navRouteLog.js";
import { searchSpanshSystemsByName } from "./spanshSystemHydration.js";
import { searchEdsmSystemsByName } from "./edsmSystemHydration.js";

export const NEAR_LY = 1;

export type StopPoint = { name: string; x: number; y: number; z: number; address?: number };
/** A system by its name: its address, and its place when the source gives one. */
export type NamedSystem = { name: string; addr: number; x?: number; y?: number; z?: number };

export interface StopLookups {
  /** What this PC knows, at once. */
  local: (name: string) => NamedSystem[];
  /** Spansh and EDSM, asked only for the stops nothing here knows. */
  remote?: (name: string) => Promise<NamedSystem[]>;
}

const matches = (s: NamedSystem, w: StopPoint): boolean =>
  s.name.toLowerCase() === w.name.trim().toLowerCase() &&
  s.addr > 0 &&
  (s.x == null || s.y == null || s.z == null || Math.hypot(s.x - w.x, s.y - w.y, s.z - w.z) <= NEAR_LY);

/** The stops with an address wherever one is found; the others as they came. */
export async function withStopAddresses<T extends StopPoint>(stops: readonly T[], look: StopLookups): Promise<T[]> {
  return Promise.all(
    stops.map(async (w) => {
      if (w.address != null && w.address > 0) return w;
      let hit = look.local(w.name).find((s) => matches(s, w));
      if (!hit && look.remote) hit = (await look.remote(w.name).catch(() => [])).find((s) => matches(s, w));
      return hit ? { ...w, address: hit.addr } : w;
    }),
  );
}

/** The journals' systems, the game's visited list and the galaxy index (galaxyFind), then the plotted routes. */
export function localStopLookup(
  t: TileIndex | null,
  store: GameStateStore | null,
  imported: readonly { addr: number; name: string; x: number; y: number; z: number }[],
): StopLookups["local"] {
  return (name) => [
    ...galaxyFind(t, store, name, imported).systems.flatMap((s) =>
      s.addr ? [{ name: s.name, addr: Number(s.addr), x: s.x, y: s.y, z: s.z }] : [],
    ),
    ...findPlottedSystems(name).map((p) => ({ name: p.name, addr: p.address, x: p.pos[0], y: p.pos[1], z: p.pos[2] })),
  ];
}

/*
  Spansh first (it gives the place with the address), EDSM when Spansh has nothing by that name. Remembered for the
  app's life: a kept stop is planned again and again, and a system's address never changes.
*/
const remembered = new Map<string, NamedSystem[]>();
const REMEMBER = 200;

export async function remoteStopLookup(name: string): Promise<NamedSystem[]> {
  const k = name.trim().toLowerCase();
  const had = remembered.get(k);
  if (had) return had;
  const exact = (n: string) => n.toLowerCase() === k;
  const sp = await searchSpanshSystemsByName(name, 25);
  let answered = sp.ok;
  let out: NamedSystem[] = sp.ok
    ? sp.systems.filter((s) => exact(s.starSystem)).map((s) => ({ name: s.starSystem, addr: s.systemAddress, x: s.x, y: s.y, z: s.z }))
    : [];
  if (!out.length) {
    const ed = await searchEdsmSystemsByName(name, 30);
    answered &&= ed.ok;
    out = ed.ok
      ? ed.systems.filter((s) => exact(s.starSystem)).map((s) => ({ name: s.starSystem, addr: s.systemAddress, x: s.x, y: s.y, z: s.z }))
      : [];
  }
  // A failed search is asked again next time; a name neither knows is not.
  if (out.length || answered) {
    if (remembered.size >= REMEMBER) remembered.delete(remembered.keys().next().value!);
    remembered.set(k, out);
  }
  return out;
}
