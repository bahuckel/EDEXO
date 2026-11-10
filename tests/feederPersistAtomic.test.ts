/**
 * The feeder corpus is written beside itself and renamed over (review F-F3): a crash mid-write used
 * to truncate the only copy.
 */
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openFeederStore } from "../src/feeder/feederDb.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "edexo-feeder-persist-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("feeder persist", () => {
  it("leaves only the database, which opens again with what was written", async () => {
    const file = path.join(dir, "corpus.sqlite");
    const a = await openFeederStore(file);
    a.db.run("CREATE TABLE t (x INTEGER);");
    a.db.run("INSERT INTO t VALUES (42);");
    a.persist();
    expect(readdirSync(dir)).toEqual(["corpus.sqlite"]);
    const b = await openFeederStore(file);
    expect(b.db.exec("SELECT x FROM t")[0]!.values).toEqual([[42]]);
  });

  it("saves the steps of an import once, at the end, and what was committed before a throw (review 2026-11-07 §4.1)", async () => {
    const file = path.join(dir, "corpus.sqlite");
    const store = await openFeederStore(file);
    let saves = 0;
    const persist = store.persist.bind(store);
    store.persist = () => {
      saves++;
      persist();
    };
    const coords = (name: string) => [{ name, x: 1, y: 2, z: 3 }];
    store.holdWrites(() => {
      store.setSystemCoords(coords("A"));
      store.setSystemCoords(coords("B"));
      expect(saves).toBe(0);
    });
    expect(saves).toBe(1);
    store.setSystemCoords(coords("C"));
    expect(saves).toBe(2);
    expect(() =>
      store.holdWrites(() => {
        store.setSystemCoords(coords("D"));
        throw new Error("stop");
      }),
    ).toThrow("stop");
    expect(saves).toBe(3);
    // Nothing committed inside: no save.
    store.holdWrites(() => {});
    expect(saves).toBe(3);
  });
});
