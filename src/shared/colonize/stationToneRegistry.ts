import { STATION_TONE_COUNT } from "./mergeCheckoutPlans";
import { storageGet, storageSet } from "./storage";

const STATION_TONE_REGISTRY_KEY = "edexo-colonize-station-tones-v6";

export type StationRef = {
  systemName: string;
  stationName: string;
  marketId?: string | null;
};

export type StationToneRegistry = {
  /** Lowercase station name → palette index. */
  assignments: Record<string, number>;
  /** Station names in assignment order (1st = dark red, 2nd = dark green, …). */
  order: string[];
};

export function stationNameKey(stationName: string): string {
  return stationName.trim().toLowerCase();
}

function emptyStationToneRegistry(): StationToneRegistry {
  return { assignments: {}, order: [] };
}

function migrateOrderFromAssignments(assignments: Record<string, number>): string[] {
  return Object.entries(assignments)
    .sort((a, b) => a[1] - b[1])
    .map(([name]) => name);
}

export function loadStationToneRegistry(): StationToneRegistry {
  try {
    const raw = storageGet(STATION_TONE_REGISTRY_KEY);
    if (!raw) return emptyStationToneRegistry();
    const parsed = JSON.parse(raw) as Partial<StationToneRegistry>;
    if (!parsed || typeof parsed.assignments !== "object" || parsed.assignments == null) {
      return emptyStationToneRegistry();
    }
    const assignments = parsed.assignments as Record<string, number>;
    const order = Array.isArray(parsed.order) && parsed.order.length
      ? parsed.order.filter((n) => typeof n === "string")
      : migrateOrderFromAssignments(assignments);
    return { assignments, order };
  } catch {
    return emptyStationToneRegistry();
  }
}

export function saveStationToneRegistry(registry: StationToneRegistry): void {
  try {
    storageSet(STATION_TONE_REGISTRY_KEY, JSON.stringify(registry));
  } catch {
    /* */
  }
}

function nextFreePaletteIndex(used: Set<number>): number | null {
  const limit = STATION_TONE_COUNT;
  for (let i = 0; i < limit; i++) {
    if (!used.has(i)) return i;
  }
  return null;
}

/** Preserve first-seen order from refs (listings → trips → dock), not alphabetical. */
function activeStationNamesInOrder(refs: StationRef[]): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const ref of refs) {
    const name = stationNameKey(ref.stationName);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  return names;
}

/**
 * One palette index per station name — 1st seen = dark red, 2nd = dark green, 3rd = dark blue, etc.
 */
export function buildStationColorAssignments(
  refs: StationRef[],
  persisted: Record<string, number>,
  persistedOrder: string[] = [],
): { assignments: Record<string, number>; order: string[]; changed: boolean } {
  const assignments = { ...persisted };
  const order = [...persistedOrder.filter((n) => assignments[n] != null)];
  let changed = false;

  for (const name of Object.keys(assignments)) {
    if (!order.includes(name)) {
      order.push(name);
      changed = true;
    }
  }

  const activeNames = activeStationNamesInOrder(refs);

  const usedSlots = new Set<number>(Object.values(assignments));
  const slotOwner = new Map<number, string>();
  for (const [name, slot] of Object.entries(assignments)) {
    const owner = slotOwner.get(slot);
    if (!owner) {
      slotOwner.set(slot, name);
      continue;
    }
    if (owner === name) continue;
    const free = nextFreePaletteIndex(usedSlots);
    if (free == null) continue;
    assignments[name] = free;
    usedSlots.delete(slot);
    usedSlots.add(free);
    slotOwner.delete(slot);
    slotOwner.set(free, name);
    changed = true;
  }

  usedSlots.clear();
  for (const slot of Object.values(assignments)) usedSlots.add(slot);

  for (const name of activeNames) {
    if (assignments[name] != null) continue;
    const free = nextFreePaletteIndex(usedSlots);
    if (free == null) continue;
    assignments[name] = free;
    usedSlots.add(free);
    order.push(name);
    changed = true;
  }

  return { assignments, order, changed };
}

export function buildStationToneMap(
  refs: StationRef[],
  assignments: Record<string, number>,
): Map<string, number> {
  const map = new Map<string, number>();
  for (const ref of refs) {
    const tone = assignments[stationNameKey(ref.stationName)];
    if (tone == null) continue;
    map.set(stationNameKey(ref.stationName), tone);
    const mid = ref.marketId?.trim();
    if (mid) map.set(`m:${mid}`, tone);
    map.set(`s:${ref.systemName.trim().toLowerCase()}\0${ref.stationName.trim().toLowerCase()}`, tone);
  }
  return map;
}
