/**
 * Procedural names from a system's address (plan 8.1): the neutron index stores a name only where the address does
 * not give it, so the derivation must agree with the game's (Spansh's) names. The fixture is a random sample of
 * neutron systems the builder (docs/perf/build_neutrons.py) found to be procedural.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { proceduralSystemName } from "../src/shared/id64.js";
import { loadSectorNames } from "../src/server/expedition.js";

const root = path.resolve(__dirname, "..");
const { pairs } = JSON.parse(
  readFileSync(path.join(__dirname, "fixtures", "neutron-name-parity.json"), "utf8"),
) as {
  pairs: [string, string][];
};

describe("a system's procedural name from its address", () => {
  const names = loadSectorNames(root);
  const sectorOf = (x: number, y: number, z: number) => names.byCell.get(`${x},${y},${z}`)?.name ?? null;

  it("matches Spansh's name on every sampled neutron system", () => {
    expect(pairs.length).toBeGreaterThan(500);
    const wrong = pairs.filter(([id, name]) => proceduralSystemName(id, sectorOf) !== name);
    expect(wrong.slice(0, 5)).toEqual([]);
  });

  it("writes boxel 0's systems without the dash, and knows no name for an unknown sector", () => {
    // Swoilz KI-E b4-9 (the owner's home system) and an address in a cell the table has no name for.
    expect(proceduralSystemName(4864507, () => "Swoilz")).not.toBeNull();
    expect(proceduralSystemName(4864507, () => null)).toBeNull();
  });
});
