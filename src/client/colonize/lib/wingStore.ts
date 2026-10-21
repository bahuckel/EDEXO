/** The wing manifest the commander keeps (who hauls what), in this browser's storage until P5 moves it server-side. */
import { parseWingMembers } from "../../../shared/colonize/storageValidation";
import type { WingMember } from "../../../shared/colonize/wingManifest";

const WING_STORAGE_KEY = "edexo-colonize-wing-manifest-v1";

export function loadWingManifest(): WingMember[] {
  try {
    const raw = localStorage.getItem(WING_STORAGE_KEY);
    if (!raw) return [];
    return parseWingMembers(JSON.parse(raw) as unknown);
  } catch {
    return [];
  }
}

export function saveWingManifest(members: WingMember[]): void {
  try {
    localStorage.setItem(WING_STORAGE_KEY, JSON.stringify(members));
  } catch {
    /* storage full or blocked: the manifest lives for this session */
  }
}
