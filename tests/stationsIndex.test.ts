/**
 * The station index (plan 7, 1.2.16): the file docs/perf/build_stations.py writes, read back, and "the nearest station
 * with a service" — all of them or any, a pad at least this size, at most this far from arrival, settlements and
 * colony construction only when asked.
 */
import { describe, expect, it } from "vitest";
import { StationsIndex } from "../src/server/stationsIndex.js";

const SERVICES = [
  "Refuel",
  "Repair",
  "Restock",
  "Market",
  "Universal Cartographics",
  "Vista Genomics",
  "Material Trader",
];
const TYPES = ["", "Coriolis Starport", "Outpost", "Settlement", "Planetary Construction Depot"];

interface St {
  name: string;
  services: string[];
  type: string;
  pad: 0 | 1 | 2 | 3;
  ls: number;
  day?: number;
}
interface Sys {
  name: string;
  x: number;
  y: number;
  z: number;
  stations: St[];
}

/** The builder's layout (build_stations.py), for a handful of systems. */
function encode(systems: Sys[]): Buffer {
  const strings: number[] = [];
  const at = new Map<string, number>();
  const str = (t: string) => {
    if (at.has(t)) return at.get(t)!;
    const b = Buffer.from(t, "utf8");
    at.set(t, strings.length);
    strings.push(b.length, ...b);
    return at.get(t)!;
  };
  const sysTab: Buffer[] = [];
  const stTab: Buffer[] = [];
  let n = 0;
  systems.forEach((s, si) => {
    const r = Buffer.alloc(22);
    r.writeFloatLE(s.x, 0);
    r.writeFloatLE(s.y, 4);
    r.writeFloatLE(s.z, 8);
    r.writeUInt32LE(str(s.name), 12);
    r.writeUInt32LE(n, 16);
    r.writeUInt16LE(s.stations.length, 20);
    sysTab.push(r);
    for (const st of s.stations) {
      const o = Buffer.alloc(20);
      o.writeUInt32LE(si, 0);
      o.writeUInt32LE(st.services.reduce((m, x) => m | (1 << SERVICES.indexOf(x)), 0) >>> 0, 4);
      o[8] = TYPES.indexOf(st.type);
      o[9] = st.pad;
      o.writeFloatLE(st.ls, 10);
      o.writeUInt16LE(st.day ?? 4667, 14);
      o.writeUInt32LE(str(st.name), 16);
      stTab.push(o);
      n++;
    }
  });
  const meta = Buffer.from(
    JSON.stringify({
      services: SERVICES,
      types: TYPES,
      systems: systems.length,
      stations: n,
      dump: "2026-10-12",
    }),
  );
  const head = Buffer.alloc(16);
  head.write("EDEXOSTA", 0, "latin1");
  head.writeUInt32LE(1, 8);
  head.writeUInt32LE(meta.length, 12);
  const counts = Buffer.alloc(8);
  counts.writeUInt32LE(systems.length, 0);
  counts.writeUInt32LE(n, 4);
  return Buffer.concat([head, meta, counts, ...sysTab, ...stTab, Buffer.from(strings)]);
}

const SYSTEMS: Sys[] = [
  {
    name: "Near",
    x: 10,
    y: 0,
    z: 0,
    stations: [
      { name: "Near Outpost", services: ["Refuel", "Repair"], type: "Outpost", pad: 2, ls: 500 },
      { name: "Near Camp", services: ["Refuel", "Vista Genomics"], type: "Settlement", pad: 1, ls: 300 },
    ],
  },
  {
    name: "Middle",
    x: 50,
    y: 0,
    z: 0,
    stations: [
      {
        name: "Middle Port",
        services: ["Refuel", "Repair", "Restock", "Universal Cartographics", "Vista Genomics"],
        type: "Coriolis Starport",
        pad: 3,
        ls: 9000,
      },
      {
        name: "Middle Depot",
        services: ["Material Trader"],
        type: "Planetary Construction Depot",
        pad: 3,
        ls: 100,
      },
    ],
  },
  {
    name: "Far",
    x: 200,
    y: 0,
    z: 0,
    stations: [
      {
        name: "Far Port",
        services: [
          "Refuel",
          "Repair",
          "Restock",
          "Universal Cartographics",
          "Vista Genomics",
          "Material Trader",
        ],
        type: "Coriolis Starport",
        pad: 3,
        ls: 20,
      },
    ],
  },
];

describe("the station index", () => {
  const idx = new StationsIndex(encode(SYSTEMS));
  const at = { x: 0, y: 0, z: 0 };

  it("reads its header and counts", () => {
    expect(idx.systemCount).toBe(3);
    expect(idx.stationCount).toBe(5);
    expect(idx.meta.dump).toBe("2026-10-12");
  });

  it("lists the nearest first, and leaves settlements and colony construction out unless asked", () => {
    expect(idx.nearest({ from: at }).map((r) => r.name)).toEqual(["Near Outpost", "Middle Port", "Far Port"]);
    expect(idx.nearest({ from: at, settlements: true, construction: true }).map((r) => r.name)).toEqual([
      "Near Outpost",
      "Near Camp",
      "Middle Port",
      "Middle Depot",
      "Far Port",
    ]);
  });

  it("wants every chosen service at one station, or any of them", () => {
    expect(
      idx.nearest({ from: at, services: ["Vista Genomics", "Universal Cartographics"] }).map((r) => r.name),
    ).toEqual(["Middle Port", "Far Port"]);
    expect(
      idx.nearest({ from: at, services: ["Material Trader", "Repair"], mode: "any" }).map((r) => r.name),
    ).toEqual(["Near Outpost", "Middle Port", "Far Port"]);
  });

  it("filters by pad and by distance from arrival", () => {
    expect(idx.nearest({ from: at, minPad: "L" }).map((r) => r.name)).toEqual(["Middle Port", "Far Port"]);
    expect(idx.nearest({ from: at, minPad: "L", maxDistanceLs: 1000 }).map((r) => r.name)).toEqual([
      "Far Port",
    ]);
  });

  it("gives a row's facts in words", () => {
    const r = idx.nearest({ from: at, limit: 1 })[0]!;
    expect(r).toMatchObject({
      name: "Near Outpost",
      system: "Near",
      pad: "M",
      type: "Outpost",
      distanceLs: 500,
      distanceLy: 10,
    });
    expect(r.services).toEqual(["Refuel", "Repair"]);
    expect(r.updated).toBe("2026-10-12");
  });

  it("gives one point per system with its largest pad, and a system's stations by position", () => {
    const pts: [string, number, number][] = [];
    idx.forEachSystem((_x, _y, _z, pad, n, name) => pts.push([name(), pad, n]));
    expect(pts).toEqual([
      ["Near", 2, 2],
      ["Middle", 3, 2],
      ["Far", 3, 1],
    ]);
    expect(idx.stationsNear({ x: 50.2, y: 0, z: 0 }).map((r) => r.name)).toEqual([
      "Middle Port",
      "Middle Depot",
    ]);
    expect(idx.stationsNear({ x: 120, y: 0, z: 0 })).toEqual([]);
  });

  it("finds stations by name, a name used twice with its system, and a station by its system's name too", () => {
    const st = (name: string): St => ({ name, services: ["Refuel"], type: "Outpost", pad: 2, ls: 10 });
    const two = new StationsIndex(
      encode([
        { name: "Wolf 73", x: 0, y: 0, z: 0, stations: [st("Hubble Gateway"), st("Ross Dock")] },
        { name: "10 Kappa Pegasi", x: 9, y: 0, z: 0, stations: [st("Hubble Gateway")] },
        { name: "Sol", x: 20, y: 0, z: 0, stations: [st("Abraham Lincoln"), st("The Hub")] },
      ]),
    );
    const hub = two.search("hub");
    // Names starting with the words first; the twice-used name knows it is not alone.
    expect(hub.map((r) => [r.name, r.system, r.dup])).toEqual([
      ["Hubble Gateway", "10 Kappa Pegasi", true],
      ["Hubble Gateway", "Wolf 73", true],
      ["The Hub", "Sol", false],
    ]);
    // Station and system together, and each row points at its system's dot on the Stations layer.
    expect(two.search("hubble gateway wolf").map((r) => [r.system, r.sys])).toEqual([["Wolf 73", 0]]);
    expect(two.search("lincoln")[0]).toMatchObject({ name: "Abraham Lincoln", sys: 2, dup: false });
    // From a position: nearest first, over every match.
    expect(two.search("hub", 12, { x: 20, y: 0, z: 0 }).map((r) => r.system)).toEqual([
      "Sol",
      "10 Kappa Pegasi",
      "Wolf 73",
    ]);
    // A system's name alone does not list its stations, and two letters are not a search.
    expect(two.search("kappa")).toEqual([]);
    expect(two.search("hu")).toEqual([]);
  });

  it("leaves out installations (no landing pad) everywhere, and numbers the map's dots without them", () => {
    // An installation has no type name in the dump (and no pad); a pad means Outpost here.
    const st = (name: string, pad: 0 | 1 | 2 | 3): St => ({
      name,
      services: ["Refuel"],
      type: pad ? "Outpost" : "",
      pad,
      ls: 10,
    });
    const idx2 = new StationsIndex(
      encode([
        { name: "Only installations", x: 0, y: 0, z: 0, stations: [st("Relay Alpha", 0)] },
        { name: "Mixed", x: 5, y: 0, z: 0, stations: [st("Relay Beta", 0), st("Mixed Port", 2)] },
        { name: "Port", x: 9, y: 0, z: 0, stations: [st("Relay Port", 3)] },
      ]),
    );
    const counts: [string, number][] = [];
    idx2.forEachSystem((_x, _y, _z, _pad, n, name) => counts.push([name(), n]));
    expect(counts).toEqual([
      ["Only installations", 0],
      ["Mixed", 1],
      ["Port", 1],
    ]);
    expect(idx2.nearest({ from: { x: 0, y: 0, z: 0 } }).map((r) => r.name)).toEqual([
      "Mixed Port",
      "Relay Port",
    ]);
    expect(idx2.search("relay").map((r) => r.name)).toEqual(["Relay Port"]);
    expect(idx2.stationsNear({ x: 5, y: 0, z: 0 }).map((r) => r.name)).toEqual(["Mixed Port"]);
    expect(idx2.stationsNear({ x: 0, y: 0, z: 0 })).toEqual([]);
    // The layer draws "Mixed" and "Port" only: their dots are 0 and 1.
    expect([idx2.pointOf(0), idx2.pointOf(1), idx2.pointOf(2)]).toEqual([-1, 0, 1]);
    expect(idx2.search("relay port")[0]!.sys).toBe(1);
  });

  it("gives a station type at least the pad it always has: depots and starports L, outposts M", () => {
    const st = (name: string, type: string, pad: 0 | 1 | 2 | 3): St => ({
      name,
      services: ["Refuel"],
      type,
      pad,
      ls: 10,
    });
    const idx3 = new StationsIndex(
      encode([
        {
          name: "Colony",
          x: 0,
          y: 0,
          z: 0,
          stations: [
            // The game reports an Orbital Construction Site as medium pads only; large ships dock there.
            st("Orbital Construction Site: Lunan Depot", "Planetary Construction Depot", 2),
            st("Hub", "Coriolis Starport", 0),
            st("Dock", "Outpost", 0),
            st("Camp", "Settlement", 1),
          ],
        },
      ]),
    );
    expect(idx3.stationsNear({ x: 0, y: 0, z: 0 }).map((r) => [r.name, r.pad])).toEqual([
      ["Orbital Construction Site: Lunan Depot", "L"],
      ["Hub", "L"],
      ["Dock", "M"],
      ["Camp", "S"],
    ]);
  });

  it("refuses what is not one", () => {
    const buf = encode(SYSTEMS);
    const wrong = Buffer.from(buf);
    wrong.write("NOTSTATN", 0, "latin1");
    expect(() => new StationsIndex(wrong)).toThrow(/not a stations index/);
    expect(() => new StationsIndex(buf.subarray(0, 80))).toThrow(/truncated/);
  });
});

/*
  Owner, 2026-10-15: "Station search - shows System Colonisation Ships even when 'Colony construction' is toggled off".
  Spansh's dump types them as outposts, named "System Colonisation Ship" or the game's raw $EXT_PANEL_ColonisationShip.
*/
describe("colonisation ships", () => {
  const idx = new StationsIndex(
    encode([
      {
        name: "Claimed",
        x: 5,
        y: 0,
        z: 0,
        stations: [
          { name: "System Colonisation Ship", services: ["Refuel"], type: "Outpost", pad: 3, ls: 10 },
          { name: "$EXT_PANEL_ColonisationShip:#index=1;", services: ["Refuel"], type: "Outpost", pad: 3, ls: 20 },
          { name: "Claimed Outpost", services: ["Refuel"], type: "Outpost", pad: 2, ls: 30 },
        ],
      },
    ]),
  );
  const at = { x: 0, y: 0, z: 0 };

  it("count as colony construction: left out unless asked", () => {
    expect(idx.nearest({ from: at }).map((r) => r.name)).toEqual(["Claimed Outpost"]);
    expect(idx.nearest({ from: at, construction: true }).map((r) => r.name)).toEqual([
      "System Colonisation Ship",
      "System Colonisation Ship",
      "Claimed Outpost",
    ]);
  });
});
