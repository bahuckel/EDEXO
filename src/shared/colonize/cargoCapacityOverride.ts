import { storageGet, storageSet, storageRemove } from "./storage";
import { KEY_CARGO_CAPACITY as CARGO_CAPACITY_KEY } from "./uiStateKeys";

export function loadCargoCapacityOverride(): number | null {
  try {
    const raw = storageGet(CARGO_CAPACITY_KEY);
    if (!raw) return null;
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return null;
    return Math.floor(n);
  } catch {
    return null;
  }
}

export function saveCargoCapacityOverride(tons: number): void {
  const n = Math.floor(tons);
  if (!Number.isFinite(n) || n <= 0) return;
  try {
    storageSet(CARGO_CAPACITY_KEY, String(n));
  } catch {
    /* */
  }
}

export function clearCargoCapacityOverride(): void {
  try {
    storageRemove(CARGO_CAPACITY_KEY);
  } catch {
    /* */
  }
}

/** Manual override wins when set; otherwise journal `Cargo.json` Capacity. */
export function resolveCargoCapacity(journalCapacity: number | null, manualOverride?: number | null): number | null {
  if (manualOverride != null && manualOverride > 0) return manualOverride;
  if (journalCapacity != null && journalCapacity > 0) return journalCapacity;
  return null;
}
