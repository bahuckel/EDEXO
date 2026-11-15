/**
 * The species panel's order inside a genus (client/SpeciesRows.tsx orderRows): by chance, and where the FSS correction
 * put two rows on the same chance, by the model's own chance before it (1.4.0: the per-genus map is flat in places, and
 * a tie fell to delivery order and moved the first species of a genus).
 */
import { describe, expect, it } from "vitest";
import { orderRows } from "../src/client/SpeciesRows.js";

type Row = Parameters<typeof orderRows>[0][number];
const row = (id: string, pct: number, before?: number) =>
  ({ entry: { id, displayName: id, genus: "Recepta" }, presenceProbabilityPercent: pct, chanceBeforeRecal: before }) as unknown as Row;
const ctx = { locks: [], live: null };

describe("orderRows", () => {
  it("orders by chance", () => {
    expect(orderRows([row("a", 20), row("b", 60)], ctx).map((m) => m.entry.id)).toEqual(["b", "a"]);
  });

  it("breaks a tie the correction made with the chance before it", () => {
    const rows = [row("conditivus", 48.6, 47.1), row("umbrux", 48.6, 49.3)];
    expect(orderRows(rows, ctx).map((m) => m.entry.id)).toEqual(["umbrux", "conditivus"]);
  });

  it("keeps delivery order when both chances tie", () => {
    expect(orderRows([row("x", 30, 30), row("y", 30, 30)], ctx).map((m) => m.entry.id)).toEqual(["x", "y"]);
  });
});
