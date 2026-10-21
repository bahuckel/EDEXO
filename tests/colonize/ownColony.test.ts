/** Which of the commander's colonies a site is in (shared/colonize/ownColony.ts). */
import { describe, expect, it } from "vitest";
import { colonyOf } from "../../src/shared/colonize/ownColony";

const colonies = [
  { name: "Swoilz KI-E b4-9", systemAddress: 20464042518049, claimedAt: "2026-05-15T19:04:23Z" },
  { name: "Col 285 Sector DR-C c13-20", systemAddress: 5581679104762, claimedAt: "2025-09-17T02:56:59Z" },
];

describe("colonyOf", () => {
  it("matches by system address, else by name in any case, else none", () => {
    expect(colonyOf({ starSystem: "renamed?", systemAddress: 20464042518049 }, colonies)?.name).toBe("Swoilz KI-E b4-9");
    expect(colonyOf({ starSystem: "col 285 sector dr-c c13-20", systemAddress: null }, colonies)?.systemAddress).toBe(5581679104762);
    expect(colonyOf({ starSystem: "Col 285 Sector AK-W b16-5", systemAddress: 99 }, colonies)).toBeNull();
    expect(colonyOf({ starSystem: null, systemAddress: null }, colonies)).toBeNull();
    expect(colonyOf({ starSystem: "Swoilz KI-E b4-9", systemAddress: 1 }, [])).toBeNull();
  });
});
