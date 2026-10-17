/**
 * After a DSS each named genus is on the body once: its listed species' chances add up to at most 100 % (1.2.19;
 * candidatePipeline.ts). Two Cactoida at 64 % and 76 % on a 2-signal body were the case seen.
 */
import { describe, expect, it } from "vitest";
import { capNamedGeneraAfterDss } from "../src/server/candidatePipeline.js";
import type { SpeciesMatch } from "../src/shared/types.js";

const row = (genus: string, pct: number, unlikely = false) =>
  ({ entry: { genus }, presenceProbabilityPercent: pct, unlikely }) as unknown as SpeciesMatch;

describe("named genera after a DSS", () => {
  it("scales a genus past 100 % down to 100 %, keeping its order; others and hidden rows untouched", () => {
    const m = [row("Cactoida", 64), row("Cactoida", 76), row("Concha", 100), row("Cactoida", 30, true)];
    capNamedGeneraAfterDss(m, { genusHints: ["Cactoida", "Concha"] } as never);
    expect(m.map((x) => x.presenceProbabilityPercent)).toEqual([45.7, 54.3, 100, 30]);
  });

  it("does nothing before a DSS", () => {
    const m = [row("Cactoida", 64), row("Cactoida", 76)];
    capNamedGeneraAfterDss(m, { genusHints: [] } as never);
    expect(m.map((x) => x.presenceProbabilityPercent)).toEqual([64, 76]);
  });
});
