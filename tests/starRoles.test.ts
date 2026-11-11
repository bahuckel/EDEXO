/**
 * Which stars the route strip and the system map call scoopable (review 2026-11-10 B5): the class letter, not any
 * string that starts with it. Herbig Ae/Be (`AeBe`) and MS-type stars are not scoopable.
 */
import { describe, expect, it } from "vitest";
import path from "node:path";
import { loadStarRolesConfig, roleForStarType } from "../src/server/systemMap.js";

const cfg = loadStarRolesConfig(path.resolve(__dirname, ".."));

describe("star roles", () => {
  it.each(["K", "G", "B", "F", "O", "A", "M", "K3", "M_RedGiant", "M_RedGiant8", "A_BlueWhiteSuperGiant", "K (Yellow-Orange) Star"])(
    "%s is fuel",
    (s) => expect(roleForStarType(s, cfg)).toBe("fuel"),
  );

  it.each(["AeBe", "MS", "MS4", "MS-type Star", "TTS", "L", "T", "Y", "C", "CN", "S", "W", "WN"])("%s is not", (s) =>
    expect(roleForStarType(s, cfg)).toBe("useless"),
  );

  it("keeps the boosts", () => {
    expect(roleForStarType("N", cfg)).toBe("neutron_boost");
    expect(roleForStarType("DA", cfg)).toBe("wd_boost");
    expect(roleForStarType("H", cfg)).toBe("useless");
  });
});
