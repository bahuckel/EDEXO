/*
  The bell's [CODEX FIRST] and rare-colour notices for the system he is in (split out of edexoBootstrap.ts, plan
  2026-11-10 Phase 7.1).
*/
import type { AppSnapshot } from "../shared/types.js";
import { isRareColour } from "../shared/rareColour.js";
import type { GameStateStore } from "./gameState.js";
import type { CodexFirstFind, NoticesService, RareColourFind } from "./notices.js";

/*
  The codex-first announcement writes the notices file, so it runs with the push, never on a read:
  GET /api/state used to write it too (code review 2026-10-10, A6), the same reason the one-shot
  auto-select moved out of the snapshot.
*/
export function createCodexFirstAnnounce({ store, notices }: { store: GameStateStore; notices: NoticesService }) {
  return (snap: AppSnapshot): void => {
    // [CODEX FIRST] candidates (owner, 2026-09-30) and rare colours (1.2.19) in the system he is in go to the bell, once
    // each, and leave it when the body's candidates no longer hold them (owner, 2026-10-04). One walk for both.
    const prefs = notices.prefs();
    if (snap.journalBoot || store.currentSystemAddress == null || (!prefs.codexFirst && !prefs.rareColours)) return;
    const firsts: CodexFirstFind[] = [];
    const rare: RareColourFind[] = [];
    const evaluated = new Set<string>();
    for (const b of snap.bodies ?? []) {
      if (b.state.systemAddress !== store.currentSystemAddress) continue;
      evaluated.add(b.state.key);
      const where = {
        bodyKey: b.state.key,
        systemAddress: b.state.systemAddress,
        system: b.state.starSystem || store.currentSystem || "",
        body: b.tabLabel || b.state.bodyName,
      };
      for (const m of b.matches ?? []) {
        if (m.unlikely) continue;
        const who = { species: m.entry.displayName, speciesId: m.entry.id };
        if (m.codexFirst && m.codexRegion)
          firsts.push({ ...where, ...who, colours: m.codexFirstColours ?? [], region: m.codexRegion });
        for (const r of (m.colourRarity ?? []).filter(isRareColour)) rare.push({ ...r, ...where, ...who });
      }
    }
    const at = new Date().toISOString();
    const changed = [
      prefs.codexFirst && notices.announceCodexFirst(firsts, at, evaluated),
      prefs.rareColours && notices.announceRareColours(rare, at, evaluated),
    ].some(Boolean);
    if (changed) snap.notices = notices.snapshot(store.viewingSystemAddress ?? store.currentSystemAddress ?? null);
  };
}
