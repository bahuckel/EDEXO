/**
 * The galaxy index button in systems, not megabytes (owner, 2026-10-12: "+10.3k systems if you download
 * now" instead of 258 MB).
 */
import { describe, expect, it } from "vitest";
import { fmtSystems, updateGain } from "../src/client/GalaxyIndexDownload";

describe("galaxy index label", () => {
  it("writes counts short", () => {
    expect(fmtSystems(5_337_927)).toBe("5.3 million");
    expect(fmtSystems(10_300)).toBe("10.3k");
    expect(fmtSystems(250_000)).toBe("250k");
    expect(fmtSystems(870)).toBe("870");
  });

  it("says what an update brings", () => {
    expect(updateGain({ systemsHere: 5_337_927, systemsOnRelease: 5_348_227 })).toBe("+10.3k systems");
    expect(updateGain({ systemsHere: 10, systemsOnRelease: 11 })).toBe("+1 system");
    expect(updateGain({ systemsHere: 5_337_927, systemsOnRelease: 5_337_927 })).toBe(
      "new star and planet data",
    );
    expect(updateGain({ systemsHere: null, systemsOnRelease: 5 })).toBe("newer data");
  });
});
