/**
 * A composition-scan mark whose first scan had no body name (review 2026-11-05): in flight the radar matches marks by
 * the body's name, so the plant stayed off the radar until he landed. A later scan that knows the name fills it in.
 */
import { expect, it } from "vitest";
import { withCodexScan } from "../src/server/surfaceMarksFile.js";

const scan = (latDeg: number, atIso: string) => ({ latDeg, lonDeg: 10, headingDeg: null, altitudeM: null, pitchDeg: null, atIso });
const base = { bodyKey: "1:2", label: "Stratum Tectonicas", atIso: "2026-11-05T10:00:00Z", codexName: "Stratum Tectonicas" };

it("takes the body's name from a later scan", () => {
  let list = withCodexScan([], { ...base, bodyNameNorm: "" }, scan(1, "2026-11-05T10:00:00Z"), 1_000_000);
  expect(list[0]!.bodyNameNorm).toBe("");
  list = withCodexScan(list, { ...base, bodyNameNorm: "eembaids eg-y g5 4" }, scan(1.00001, "2026-11-05T10:01:00Z"), 1_000_000);
  expect(list.every((m) => m.bodyNameNorm === "eembaids eg-y g5 4")).toBe(true);
});
