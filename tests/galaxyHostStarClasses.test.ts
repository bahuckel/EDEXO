/**
 * The galaxy scan names a dump star's class the way the app names a journal star's (review 2026-11-07 §3.2.4).
 *
 * It read the colour parser, which says `DA` for a white dwarf and nothing at all for the dump's long names, then
 * fell back to the first three letters: `White Dwarf (DA) Star` was class `WHI`, `Neutron Star` was `NEU`. No host
 * gate lists either, so Electricae pluma and the Anemones refused under exactly the stars they grow beside.
 */
import { describe, expect, it } from "vitest";
import { hostStarClassesOf } from "../src/server/galaxyBodyScan.js";
import { hostStarClassKey } from "../src/shared/hostStarClass.js";

// Every form below is in the shipped bio-bodies.bin string tables (2026-11-11).
const DUMP: [string, string][] = [
  ["DA0", "D"],
  ["White Dwarf (DA) Star", "D"],
  ["White Dwarf (DBV) Star", "D"],
  ["N0", "N"],
  ["Neutron Star", "N"],
  ["Black Hole", "H"],
  ["H0", "H"],
  ["WN0", "W"],
  ["Wolf-Rayet NC Star", "W"],
  ["AeBe3", "A"],
  ["Herbig Ae/Be Star", "A"],
  ["TTS7", "TTS"],
  ["K3", "K"],
  ["M (Red giant) Star", "M"],
  ["S-type Star", "other"],
];

describe("galaxy scan host star classes", () => {
  it.each(DUMP)("%s is %s, the key a journal star of that class gets", (dump, key) => {
    expect(hostStarClassesOf(dump)).toEqual([key]);
    expect(hostStarClassesOf(dump)).toEqual([hostStarClassKey(dump)]);
  });

  it("an empty star names no class, so the gates abstain", () => {
    expect(hostStarClassesOf("")).toEqual([]);
  });
});
