/**
 * A codex temperature edge may be reopened by an observation only as far as the EDDN year has seen the species
 * (plan-15102026-1.2.18 Part 2): Stratum paleas, codex floor 165 K, never under 165.0 K in 17,590 EDDN-year bodies.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  eddnSeenThisFarOut,
  setEddnTemperatureRangeRootForTests,
} from "../src/server/eddnTemperatureRange.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "edexo-eddntemp-"));
  mkdirSync(path.join(root, "data", "exomastery"), { recursive: true });
  writeFileSync(
    path.join(root, "data", "exomastery", "eddn-temperature-range.json"),
    JSON.stringify({
      species: {
        stratum_stratum_paleas: { minK: 165, maxK: 449.53, bodies: 17590 },
        // renibus: hot on other atmospheres, but its carbon dioxide band stops at the 195.5 K cap (the one 196.5 K
        // body is a lone outlier and sits in the register, not in the range)
        concha_concha_renibus: {
          minK: 78.82,
          maxK: 451.76,
          bodies: 7027,
          linkedMinK: 180,
          linkedMaxK: 195.5,
          linkedBodies: 3901,
        },
      },
    }),
  );
  setEddnTemperatureRangeRootForTests(root);
});

afterEach(() => {
  setEddnTemperatureRangeRootForTests(null);
  rmSync(root, { recursive: true, force: true });
});

describe("eddnSeenThisFarOut", () => {
  it("refuses a rescue below the coldest EDDN body, allows one within it", () => {
    expect(eddnSeenThisFarOut("stratum_stratum_paleas", 162.1, 165, undefined).seen).toBe(false);
    expect(eddnSeenThisFarOut("stratum_stratum_paleas", 164.6, 165, undefined).seen).toBe(true); // half a kelvin
  });

  it("does the same above the hottest", () => {
    expect(eddnSeenThisFarOut("stratum_stratum_paleas", 460, undefined, 400).seen).toBe(false);
    expect(eddnSeenThisFarOut("stratum_stratum_paleas", 440, undefined, 400).seen).toBe(true);
  });

  it("leaves species it does not know, and bodies inside the band, alone", () => {
    expect(eddnSeenThisFarOut("fungoida_fungoida_stabitis", 430, 180, 195).seen).toBe(true);
    expect(eddnSeenThisFarOut("stratum_stratum_paleas", 200, 165, undefined).seen).toBe(true);
  });
});

describe("the atmosphere-linked band has its own range", () => {
  it("does not let renibus's hot bodies elsewhere stretch its carbon dioxide cap", () => {
    expect(eddnSeenThisFarOut("concha_concha_renibus", 196.5, 180, 195.5, "flat").seen).toBe(true);
    const linked = eddnSeenThisFarOut("concha_concha_renibus", 196.5, 180, 195.5, "linked");
    expect(linked.seen).toBe(false);
    expect(linked.range?.bodies).toBe(3901);
  });

  it("leaves a species without a linked range alone", () => {
    expect(eddnSeenThisFarOut("stratum_stratum_paleas", 100, 165, undefined, "linked").seen).toBe(true);
  });
});
