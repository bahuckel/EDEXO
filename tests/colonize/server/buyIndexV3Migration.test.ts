/**
 * A version-3 buy index held Spansh / EDSM sellers at the station's sell price, not what the commander pays (review
 * 2026-11-10 B1). Read by this build without those hits (a fresh scan brings them back right); journal and Inara hits,
 * which nobody can fetch again, are kept, and the old file is copied aside first.
 */
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MaterialBuyIndex } from "../../../src/server/colonize/materialBuyIndex";
import type { MaterialBuyStationHit } from "../../../src/shared/colonize/materialBuyIndexTypes";

let dir = "";
afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

const hit = (stationName: string, dataSource: MaterialBuyStationHit["dataSource"]): MaterialBuyStationHit => ({
  systemName: "Swoilz BY-D c1-13",
  stationName,
  marketId: stationName === "Inara Port" ? "11" : "12",
  distanceLy: 3,
  buyPrice: 45,
  supply: 900,
  spanshCommodity: "Steel",
  foundAtIso: "2026-11-01T00:00:00.000Z",
  dataSource,
});

describe("a version-3 buy index", () => {
  it("loses its Spansh and EDSM sellers and keeps the journal and Inara ones", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "buy-index-v3-"));
    const file = path.join(dir, "material-buy-index.json");
    const v3 = {
      version: 3,
      systems: {
        "swoilz by-d c1-13": {
          steel: {
            commodityId: "steel",
            label: "Steel",
            updatedAtIso: "2026-11-01T00:00:00.000Z",
            stations: [hit("Inara Port", "inara"), hit("Spansh Port", "spansh")],
          },
        },
      },
    };
    await writeFile(file, JSON.stringify(v3), "utf8");
    const index = new MaterialBuyIndex(dir);
    await index.load();
    expect(index.getRow("Swoilz BY-D c1-13", "steel")?.stations.map((h) => h.stationName)).toEqual(["Inara Port"]);
    expect(existsSync(`${file}.bak-3`)).toBe(true);
    expect(JSON.parse(await readFile(`${file}.bak-3`, "utf8")).version).toBe(3);
  });
});
