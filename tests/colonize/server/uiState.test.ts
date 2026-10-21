/**
 * `colonize/ui-state.json` (1.3.0 phase 5): only the listed keys, text within the limit, whole-file writes, read back
 * on the next start, and "seeded" once any window saved.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ColonizeUiState } from "../../../src/server/colonize/uiState";
import { MAX_UI_STATE_VALUE_CHARS, cleanUiStateSet } from "../../../src/shared/colonize/uiStateKeys";

const TRIPS = "edexo-colonize-trip-plan-snapshot-v3";
const BANS = "edexo-colonize-banned-stations-v1";
const dirs: string[] = [];
const fileIn = () => {
  const d = mkdtempSync(path.join(tmpdir(), "colonize-ui-state-"));
  dirs.push(d);
  return path.join(d, "ui-state.json");
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("what may be stored", () => {
  it("keeps listed keys with text or null, drops the rest", () => {
    expect(
      cleanUiStateSet({
        [TRIPS]: "{}",
        [BANS]: null,
        "edexo-colonize-galaxy-dist-v2": "{}", // a cache: stays in the browser
        __proto__: "x",
        "edexo-colonize-planner-settings-v1": 5,
        "edexo-colonize-trade-party-v1": "x".repeat(MAX_UI_STATE_VALUE_CHARS + 1),
      }),
    ).toEqual({ [TRIPS]: "{}", [BANS]: null });
    expect(cleanUiStateSet(null)).toEqual({});
    expect(cleanUiStateSet(["x"])).toEqual({});
  });
});

describe("the file", () => {
  it("round-trips, reports only real changes, and is seeded once something was saved", () => {
    const file = fileIn();
    const a = new ColonizeUiState(file);
    expect(a.seeded).toBe(false);
    expect(a.apply({ [TRIPS]: "t1", [BANS]: null })).toEqual({ [TRIPS]: "t1" });
    expect(a.seeded).toBe(true);
    expect(a.apply({ [TRIPS]: "t1" })).toEqual({});
    a.flush();
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ version: 1, values: { [TRIPS]: "t1" } });

    const b = new ColonizeUiState(file);
    expect(b.seeded).toBe(true);
    expect(b.all()).toEqual({ [TRIPS]: "t1" });
    expect(b.apply({ [TRIPS]: null })).toEqual({ [TRIPS]: null });
    b.flush();
    expect(new ColonizeUiState(file).all()).toEqual({});
  });

  it("batches writes, and a flush with nothing pending writes nothing", async () => {
    const file = fileIn();
    const s = new ColonizeUiState(file);
    s.flush();
    expect(existsSync(file)).toBe(false);
    s.apply({ [TRIPS]: "a" });
    s.apply({ [TRIPS]: "b" });
    expect(existsSync(file)).toBe(false);
    await new Promise((r) => setTimeout(r, 450));
    expect(new ColonizeUiState(file).all()).toEqual({ [TRIPS]: "b" });
  });

  it("starts empty and unseeded from a file it cannot read, and ignores keys a later version dropped", () => {
    const file = fileIn();
    writeFileSync(file, "{ torn");
    const s = new ColonizeUiState(file);
    expect(s.all()).toEqual({});
    expect(s.seeded).toBe(false);
    writeFileSync(file, JSON.stringify({ version: 1, values: { [BANS]: "[]", "edexo-colonize-old-key-v0": "x" } }));
    expect(new ColonizeUiState(file).all()).toEqual({ [BANS]: "[]" });
  });
});
