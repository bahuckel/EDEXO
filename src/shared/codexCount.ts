/**
 * CODEX ×N for a body (plan 1.3.4 S-1, owner 2026-10-31: "only likely (one species per genus)"): for each genus on
 * the body, its likeliest candidate (the body pane's top row for that genus); N counts those not yet in the
 * commander's codex for this region in the colour the body would grow (`codexNew`), and how many of them nobody
 * has logged in the region at all (`codexFirst`).
 */
import type { SpeciesMatch } from "./dto/species.js";

export function likelyCodex(matches: readonly SpeciesMatch[]): { codexNew: number; codexFirst: number } {
  const best = new Map<string, SpeciesMatch>();
  const score = (m: SpeciesMatch) => (typeof m.presenceProbabilityPercent === "number" ? m.presenceProbabilityPercent : -1);
  for (const m of matches) {
    if (m.unlikely) continue;
    const g = m.entry.genus;
    const had = best.get(g);
    if (!had || score(m) > score(had) || (score(m) === score(had) && (m.priceCredits ?? 0) > (had.priceCredits ?? 0)))
      best.set(g, m);
  }
  let codexNew = 0;
  let codexFirst = 0;
  for (const m of best.values()) {
    if (m.codexNew !== true) continue;
    codexNew++;
    if (m.codexFirst === true) codexFirst++;
  }
  return { codexNew, codexFirst };
}
