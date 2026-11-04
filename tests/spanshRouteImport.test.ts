/**
 * A Spansh route from a file (owner, 2026-11-04): Spansh's result JSON, the result alone, or its CSV with the systems
 * placed by the coordinate look-up (server/spanshRouteImport.ts).
 */
import { describe, expect, it, vi } from "vitest";
import { importJobId, importSpanshRouteFile } from "../src/server/spanshRouteImport.js";

const norm = (s: string) => s.trim().toLowerCase();
const COORDS: Record<string, [number, number, number]> = {
  sol: [0, 0, 0],
  "alpha centauri": [3.03, -0.09, 3.16],
  "colonia": [-9530.5, -910.28, 19808.13],
};
const lookup = vi.fn(async (names: string[]) => new Map(names.filter((n) => COORDS[norm(n)]).map((n) => [norm(n), COORDS[norm(n)]!] as const)));

const JOB = "2A1B3C4D-1111-2222-3333-444455556666";
const neutronResult = {
  status: "ok",
  job: JOB,
  parameters: { from: "Sol", to: "Colonia", range: 60 },
  result: {
    system_jumps: [
      { system: "Sol", x: 0, y: 0, z: 0, jumps: 0, neutron_star: false },
      { system: "Colonia", x: -9530.5, y: -910.28, z: 19808.13, jumps: 120, neutron_star: false },
    ],
  },
};

describe("Spansh route from a file", () => {
  it("reads Spansh's result JSON and keeps its job id and link", async () => {
    const a = await importSpanshRouteFile("route.json", JSON.stringify(neutronResult), lookup, norm);
    expect(a.state).toBe("ok");
    if (a.state !== "ok") return;
    expect(a.route).toMatchObject({ job: JOB, kind: "neutron", from: "Sol", to: "Colonia", rangeLy: 60, totalJumps: 120 });
    expect(a.route.url).toContain(JOB);
  });

  it("reads the result alone, with an id from the file and no Spansh link", async () => {
    const text = JSON.stringify(neutronResult.result);
    const a = await importSpanshRouteFile("route.json", text, lookup, norm);
    expect(a.state).toBe("ok");
    if (a.state !== "ok") return;
    expect(a.route.job).toBe(importJobId(text));
    expect(a.route.job).toMatch(/^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/);
    expect(a.route.url).toBe("");
    expect(a.route.stops.map((s) => s.name)).toEqual(["Sol", "Colonia"]);
  });

  it("reads a neutron plotter CSV, placing its systems by name", async () => {
    const csv = [
      '"System Name","Distance To Arrival","Distance Remaining","Neutron Star","Jumps"',
      '"Sol","0","22000","No","0"',
      '"Alpha Centauri","4.4","21996","Yes","1"',
      '"Colonia","0","0","No","119"',
    ].join("\r\n");
    const a = await importSpanshRouteFile("route.csv", csv, lookup, norm);
    expect(a.state).toBe("ok");
    if (a.state !== "ok") return;
    expect(a.route).toMatchObject({ kind: "neutron", from: "Sol", to: "Colonia" });
    expect(a.route.stops.map((s) => [s.name, s.neutron, s.jumps])).toEqual([
      ["Sol", false, 0],
      ["Alpha Centauri", true, 1],
      ["Colonia", false, 119],
    ]);
    expect(a.route.stops[1]).toMatchObject({ x: 3.03, z: 3.16 });
    expect(a.note).toBeUndefined();
  });

  it("reads an exobiology CSV body by body, and says which systems could not be placed", async () => {
    const csv = [
      '"System Name","Body Name","Body Subtype","Distance To Arrival","Landmark Subtype","Value","Jumps"',
      '"Sol","Sol 3","Earth-like world","500","Bacterium Vesicula","1000000","0"',
      '"","Sol 3","Earth-like world","500","Stratum Tectonicas","19000000","0"',
      '"Nowhere AB-C d1","Nowhere AB-C d1 1","Rocky body","20","Osseus Discus","12000000","3"',
      '"Colonia","Colonia 2","Rocky body","80","Tussock Virgam","14000000","4"',
    ].join("\n");
    const a = await importSpanshRouteFile("exo.csv", csv, lookup, norm);
    expect(a.state).toBe("ok");
    if (a.state !== "ok") return;
    expect(a.route.kind).toBe("exobiology");
    expect(a.route.stops.map((s) => s.name)).toEqual(["Sol", "Colonia"]);
    expect(a.route.stops[0]!.bodies[0]!.species.map((x) => x.name)).toEqual(["Stratum Tectonicas", "Bacterium Vesicula"]);
    expect(a.route.stops[0]!.valueCr).toBe(20_000_000);
    expect(a.note).toContain("Nowhere AB-C d1");
  });

  it("says why a file is not a route", async () => {
    expect(await importSpanshRouteFile("x.json", "{ nope", lookup, norm)).toMatchObject({ state: "error" });
    expect(await importSpanshRouteFile("x.csv", '"Name","Price"\n"a","1"', lookup, norm)).toMatchObject({ state: "error" });
    expect(await importSpanshRouteFile("x.json", JSON.stringify({ hello: 1 }), lookup, norm)).toMatchObject({ state: "error" });
  });
});
