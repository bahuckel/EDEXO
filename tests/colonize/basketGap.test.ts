import { describe, expect, it } from "vitest";
import { makeCargoPool, tonsStillNeededWithPool } from "../../src/shared/colonize/basketGap";
import type { ResourceRow } from "../../src/shared/colonize/types";

describe("basketGap cargo pool", () => {
  it("shares on-hand cargo across depots", () => {
    const cargo = makeCargoPool(new Map([["aluminium", 30]]));
    const row = (required: number, provided: number): ResourceRow => ({
      name: "Aluminium",
      nameLocalised: "Aluminium",
      required,
      provided,
      payment: 0,
    });
    const need1 = tonsStillNeededWithPool(row(50, 0), cargo);
    const need2 = tonsStillNeededWithPool(row(50, 0), cargo);
    expect(need1).toBe(20);
    expect(need2).toBe(50);
    expect(need1 + need2).toBe(70);
  });
});
