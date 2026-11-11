import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { loadSpeciesDatabaseFromTree } from "../src/server/speciesTreeLoader.js";
import { matchDatabaseToScan } from "../src/server/matchSpecies.js";
import type { PlanetScan, SpeciesDatabase, SpeciesMatchContext } from "../src/shared/types.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

interface GoldenCase {
  bodyName: string;
  scan: Record<string, unknown>;
  confirmedSpecies: string[];
  biologicalSignals: number | null;
  context: SpeciesMatchContext | null;
  /** Species ids, with ` x<factor>` where a soft band kept the row at a factor. */
  candidates: string[];
  unlikely: string[];
}

const fixture = JSON.parse(
  readFileSync(path.join(root, "tests", "fixtures", "match-golden-context.json"), "utf8"),
) as { cases: GoldenCase[] };

let db: SpeciesDatabase;
beforeAll(() => {
  db = loadSpeciesDatabaseFromTree(root);
});

const run = (c: GoldenCase) =>
  matchDatabaseToScan(db, c.scan as unknown as PlanetScan, null, null, {
    includeBacterium: true,
    matchContext: c.context,
    biologicalSignals: c.biologicalSignals,
  }).matches;

const row = (m: ReturnType<typeof run>[number]) =>
  m.presenceFactor != null && m.presenceFactor !== 1 ? `${m.entry.id} x${m.presenceFactor.toFixed(4)}` : m.entry.id;

/**
 * The twenty bodies of match-golden.json again, each with the match context the app builds for it (review 2026-11-07
 * §3.3, plan 2.3): the host and colour star, the measured exclusions keyed on host, main star and region, the orbit,
 * arrival, region, companion-body and starlight gates, the signal-count restore and each soft band's "kept at ×"
 * factor, none of which the first fixture reaches (it matches with no context).
 *
 * A failure means predictions moved. Read the diff; if the move is intended, regenerate with
 * `scripts/gen-match-fixture-context.ts` (header) in the same commit.
 */
describe("golden candidate lists with the match context", () => {
  it("holds the twenty bodies, each with a context", () => {
    expect(fixture.cases.length).toBe(20);
    expect(fixture.cases.every((c) => c.context && c.context.regionName)).toBe(true);
  });

  it.each(fixture.cases.map((c, i) => [`${i} ${c.bodyName}`, c] as const))("%s", (_name, c) => {
    const matches = run(c);
    expect(matches.filter((m) => !m.unlikely).map(row).sort(), "shown tier").toEqual(c.candidates);
    expect(matches.filter((m) => m.unlikely).map(row).sort(), "unlikely tier").toEqual(c.unlikely);
  });

  it("puts the context to work: the lists differ from the no-context match on most bodies", () => {
    let moved = 0;
    for (const c of fixture.cases) {
      const bare = matchDatabaseToScan(db, c.scan as unknown as PlanetScan, null, null, { includeBacterium: true })
        .matches.filter((m) => !m.unlikely)
        .map((m) => m.entry.id)
        .sort();
      const withCtx = c.candidates.map((s) => s.split(" x")[0]!).sort();
      if (JSON.stringify(bare) !== JSON.stringify(withCtx)) moved++;
    }
    expect(moved).toBeGreaterThanOrEqual(10);
  });
});
