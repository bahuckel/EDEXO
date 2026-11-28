/**
 * Biology by age path and birth mass (src/shared/bioByAgePath.ts; owner 2026-11-28,
 * docs/boxel-star-placement-23112026.md §3n / §3s): the path is read off the system's own dice, rolls 1 and 2 (mass code
 * a: 2 and 3), the same way the star code reads it; the birth mass from roll 0 within the mass code's band.
 */
import { describe, expect, it } from "vitest";
import { agePathName, bioOddsOf } from "../src/shared/bioByAgePath.js";
import { boxelFrame, systemRolls } from "../src/shared/stellarPlacement.js";

/** The path straight from the rolls, as stellarClass.ts `agePathOf` reads it, shifted one roll for mass code a. */
const byHand = (address: bigint, shift: number) => {
  const v = systemRolls(address, 4);
  return v[1 + shift]! % 100 <= 50 ? "A" : v[2 + shift]! % 100 < 75 ? "young" : "old";
};

describe("biology by the age path and the star's birth mass", () => {
  // A mass code d boxel (the catalogue test's): its systems 0-399 cover every path and third.
  const d = boxelFrame(10393455027n)!;
  const addresses = Array.from({ length: 400 }, (_, n) => d.base | (BigInt(n) << d.shift));

  it("reads the path off the system's own dice", () => {
    const seen = new Set<string>();
    for (const address of addresses) {
      const path = agePathName(d.code, address);
      expect(path).toBe(byHand(address, 0));
      seen.add(path);
    }
    expect(seen).toEqual(new Set(["A", "young", "old"]));
  });

  it("gives d's old systems with a heavy-born star the lowest chance, young ones with a light-born star the highest", () => {
    const cells = new Map<string, number>();
    for (const address of addresses) {
      const o = bioOddsOf("d", address)!;
      expect(o.average).toBe(0.068);
      // The third from the birth mass (230 + roll 0 % 230, in 1/256 solar masses), edges at 317 and 398.
      const mass = 230 + (systemRolls(address, 1)[0]! % 230);
      expect(o.third).toBe(mass < 317 ? "light" : mass < 398 ? "middle" : "heavy");
      cells.set(`${o.path}|${o.third}`, o.chance);
    }
    expect(cells.get("old|heavy")).toBe(0.0419);
    expect(cells.get("young|light")).toBe(0.0836);
    expect(cells.size).toBe(9);
  });

  it("gives e's young systems with a light-born star about three times path A's light ones", () => {
    let young: number | undefined;
    let a: number | undefined;
    for (const address of addresses) {
      const o = bioOddsOf("e", address)!;
      if (o.third !== "light") continue;
      if (o.path === "young") young = o.chance;
      if (o.path === "A") a = o.chance;
    }
    expect(young).toBe(0.0594);
    expect(a).toBe(0.0179);
  });

  it("reads mass code a one roll later, by path alone", () => {
    let differs = false;
    for (let n = 0; n < 200; n++) {
      const address = 5242546966128n + (BigInt(n) << 44n);
      expect(agePathName("a", address)).toBe(byHand(address, 1));
      if (byHand(address, 0) !== byHand(address, 1)) differs = true;
      expect(bioOddsOf("a", address)!.third).toBeUndefined();
    }
    expect(differs).toBe(true);
  });

  it("has nothing for mass codes f to h (not measured)", () => {
    for (const code of ["f", "g", "h"] as const) expect(bioOddsOf(code, 1n)).toBeNull();
  });
});
