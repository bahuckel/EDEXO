/**
 * What EDEXO already knows about the galaxy, offered to Colonize before it asks EDSM or Spansh (1.3.0 plan P7 a/b):
 *
 * - a system's coordinates: the journal's star positions (systems the commander visited), the game's visited list
 *   EDEXO imported, then the stations index (`stations.bin`, every system with a station in Spansh's dump — every
 *   seller is a station, so it answers nearly every look-up: 858 of 859 seller systems in the owner's old buy index);
 * - a station's facts: type, largest pad and distance from the arrival star, from the same index (1,600 of 1,764
 *   stations there; fleet carriers are not in it, and pads were known for 162 before, from Inara).
 *
 * The stations index is read on the first look-up that needs it (35 MB, about 10 ms) and only if downloaded, and let go
 * with the galaxy map's other caches two idle minutes after the last look-up (galaxyMemory.ts).
 */
import type { GameStateStore } from "../gameState.js";
import { touchGalaxyMemory } from "../galaxyMemory.js";
import { loadStationsIndex, type StationsIndex } from "../stationsIndex.js";

export type LocalCoords = [number, number, number];
export type LocalStationFacts = { type: string; pad: "L" | "M" | "S" | ""; arrivalLs: number };

export type LocalGalaxySources = {
  journalStore?: () => Pick<GameStateStore, "visitedSystems" | "systemPositions"> | undefined;
  importedSystems?: () => readonly { name: string; x: number; y: number; z: number }[];
  stations?: () => Pick<StationsIndex, "system" | "station"> | null;
};

const norm = (s: string) => s.trim().toLowerCase();

/** How long the imported list is kept while the journal learns nothing new (see `importedCoords`). */
const IMPORTED_HOLD_MS = 30_000;

export function createLocalGalaxy(src: LocalGalaxySources) {
  // The journal's positions by name, rebuilt when the journal store has learned more systems.
  let visited: { size: number; pos: number; byName: Map<string, LocalCoords> } | null = null;
  const journalCoords = (name: string): LocalCoords | null => {
    const store = src.journalStore?.();
    if (!store) return null;
    if (!visited || visited.size !== store.visitedSystems.size || visited.pos !== store.systemPositions.size) {
      const byName = new Map<string, LocalCoords>();
      for (const [addr, n] of store.visitedSystems) {
        const p = store.systemPositions.get(addr);
        if (p) byName.set(norm(n), [p.x, p.y, p.z]);
      }
      visited = { size: store.visitedSystems.size, pos: store.systemPositions.size, byName };
    }
    return visited.byName.get(norm(name)) ?? null;
  };
  /*
    The imported list comes back new from every call (the bootstrap places each imported id through the galaxy
    index), and a distance resolve asks for up to 400 sellers back to back, each rebuilding it and this map (audit
    2026-10-22). Kept while the journal store has learned no system, for at most IMPORTED_HOLD_MS, so an import or a
    galaxy index loaded since is still picked up.
  */
  let imported: { at: number; size: number; pos: number; byName: Map<string, LocalCoords> } | null = null;
  const importedCoords = (name: string): LocalCoords | null => {
    if (!src.importedSystems) return null;
    const store = src.journalStore?.();
    const size = store?.visitedSystems.size ?? -1;
    const pos = store?.systemPositions.size ?? -1;
    const now = Date.now();
    if (!imported || now - imported.at > IMPORTED_HOLD_MS || imported.size !== size || imported.pos !== pos) {
      const byName = new Map<string, LocalCoords>();
      // One the galaxy index could not name sits at its boxel's centre with no name: nobody asks for "".
      for (const s of src.importedSystems()) if (s.name) byName.set(norm(s.name), [s.x, s.y, s.z]);
      imported = { at: now, size, pos, byName };
    }
    return imported.byName.get(norm(name)) ?? null;
  };

  return {
    systemCoords(name: string): LocalCoords | null {
      const fromJournal = journalCoords(name) ?? importedCoords(name);
      if (fromJournal) return fromJournal;
      const s = src.stations?.()?.system(name);
      return s ? [s.x, s.y, s.z] : null;
    },
    stationFacts(systemName: string, stationName: string): LocalStationFacts | null {
      const row = src.stations?.()?.station(systemName, stationName);
      return row ? { type: row.type, pad: row.pad, arrivalLs: row.distanceLs } : null;
    },
  };
}

export type LocalGalaxy = ReturnType<typeof createLocalGalaxy>;

/** The real sources: EDEXO's journal store, its imported visited list, the downloaded stations index. */
export function localGalaxyFrom(opts: {
  getJournalStore?: () => GameStateStore;
  getImportedSystems?: () => readonly { name: string; x: number; y: number; z: number }[];
}): LocalGalaxy {
  return createLocalGalaxy({
    journalStore: opts.getJournalStore,
    importedSystems: opts.getImportedSystems,
    /*
      Colonize's look-ups keep the index like the map's requests do, so it goes with the map's other caches five
      idle minutes after the last one (audit 2026-10-22: loaded silently, its 34 MB and name lookup stayed until
      restart).
    */
    stations: () => {
      touchGalaxyMemory();
      return loadStationsIndex();
    },
  });
}
