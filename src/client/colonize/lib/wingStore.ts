/** The wing manifest the commander keeps (who hauls what), kept on the server (uiStateKeys.ts). */
import { parseWingMembers } from "../../../shared/colonize/storageValidation";
import type { WingMember } from "../../../shared/colonize/wingManifest";
import { storageGet, storageSet } from "../../../shared/colonize/storage";
import { KEY_WING_MANIFEST as WING_STORAGE_KEY } from "../../../shared/colonize/uiStateKeys";

export function loadWingManifest(): WingMember[] {
  try {
    const raw = storageGet(WING_STORAGE_KEY);
    if (!raw) return [];
    return parseWingMembers(JSON.parse(raw) as unknown);
  } catch {
    return [];
  }
}

export function saveWingManifest(members: WingMember[]): void {
  try {
    storageSet(WING_STORAGE_KEY, JSON.stringify(members));
  } catch {
    /* storage full or blocked: the manifest lives for this session */
  }
}
