/**
 * Routes planned on Spansh (plan 1.3.6 S-1, owner 2026-11-02): reading Spansh's five result shapes, and the stops the
 * live route flies. Fixtures are Spansh's own answers to test jobs (Sol radius 25 exobiology, Sol → Colonia neutron,
 * Sol → Wolf 359 galaxy plotter and fleet carrier), cut to a few stops.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fetchSpanshRoute, parseSpanshResult, spanshJobFromText, spanshRouteHops } from "../src/server/spanshRoute.js";

const fx = (n: string) => JSON.parse(readFileSync(`tests/fixtures/spansh-route/${n}.json`, "utf8")) as { job: string };
const parse = (n: string) => {
  const d = fx(n);
  return parseSpanshResult(d.job, d)!;
};

describe("a Spansh route", () => {
  it("is found in a pasted link or as a bare job id", () => {
    expect(spanshJobFromText("https://spansh.co.uk/exobiology/results/add9d60c-d6df-11f1-8006-bb4f253d68bf?x=1")).toBe(
      "ADD9D60C-D6DF-11F1-8006-BB4F253D68BF",
    );
    expect(spanshJobFromText("  AD7B6374-D6DF-11F1-9EF1-8B05C8FD45EC ")).toBe("AD7B6374-D6DF-11F1-9EF1-8B05C8FD45EC");
    expect(spanshJobFromText("https://spansh.co.uk/plotter")).toBeNull();
  });

  it("reads an exobiology route with its species and values", () => {
    const r = parse("exo");
    expect(r.kind).toBe("exobiology");
    expect(r.from).toBe("Sol");
    expect(r.stops.map((s) => s.name)).toEqual(["Sol", "Stein 2051", "PSPF-LF 2"]);
    const stein = r.stops[1]!;
    expect(stein.jumps).toBe(1);
    expect(stein.bodies[0]).toMatchObject({ name: "Stein 2051 B 4 a", subtype: "Rocky Ice world", valueCr: 15_885_300 });
    expect(stein.bodies[0]!.species[0]).toEqual({ name: "Tussock Capillum", valueCr: 7_025_800 });
    expect(r.stops[2]!.valueCr).toBe(13_953_900 + 8_418_000 + 1_152_500 + 2_956_600);
    expect(r.totalValueCr).toBe(stein.valueCr + r.stops[2]!.valueCr);
    expect(r.url).toBe("https://spansh.co.uk/exobiology/results/ADD9D60C-D6DF-11F1-8006-BB4F253D68BF");
    // The start has no jumps to it.
    expect(r.stops[0]!.jumps).toBe(0);
  });

  it("reads a neutron route: the jump out of a neutron star is supercharged", () => {
    const r = parse("neutron");
    expect(r.kind).toBe("neutron");
    expect([r.from, r.to, r.rangeLy]).toEqual(["Sol", "Colonia", 60]);
    expect(r.stops[1]).toMatchObject({ name: "PSR J1752-2806", jumps: 8, neutron: true, id64: "22712681061" });
    const hops = spanshRouteHops(r)!;
    expect(hops[0]).toMatchObject({ name: "Sol", kind: "start", jumps: 0, boosted: 0 });
    expect(hops[1]).toMatchObject({ kind: "neutron", jumps: 8, boosted: 0 });
    expect(hops[2]).toMatchObject({ name: "Nova Aquila No 3", jumps: 5, boosted: 1 });
  });

  it("reads a galaxy plotter route and a fleet carrier route, whose tritium restocks are not the ship's refuels", () => {
    const g = parse("galaxy");
    expect(g.kind).toBe("plotter");
    expect([g.from, g.to]).toEqual(["Sol", "Wolf 359"]);
    expect(g.stops.map((s) => [s.name, s.jumps])).toEqual([
      ["Sol", 0],
      ["Wolf 359", 1],
    ]);
    const c = parse("carrier");
    expect(c.kind).toBe("carrier");
    expect(c.stops[0]!.refuel).toBe(true);
    expect([c.from, c.to]).toEqual(["Sol", "Wolf 359"]);
    expect(spanshRouteHops(c)!.map((h) => [h.name, h.refuel])).toEqual([
      ["Sol", false],
      ["Wolf 359", false],
    ]);
    expect(c.url).toContain("/fleet-carrier/results/");
  });

  it("flies only the stops kept, the jumps of the dropped ones added to the next", () => {
    const r = parse("neutron");
    const hops = spanshRouteHops(r, new Set([2, 3]))!;
    expect(hops.map((h) => [h.name, h.jumps])).toEqual([
      ["Sol", 0],
      ["Nova Aquila No 3", 13],
      [r.stops[3]!.name, r.stops[3]!.jumps],
    ]);
    // The neutron star before it was dropped: no supercharge planned out of it.
    expect(hops[1]!.boosted).toBe(0);
    expect(spanshRouteHops(r, new Set())).toBeNull();
  });

  it("links a road-to-riches variant to its own Spansh page, told by the body types asked for", () => {
    const sol = { bodies: [], id64: "10477373803", jumps: 1, name: "Sol", x: 0, y: 0, z: 0 };
    const url = (body_types?: string[]) =>
      parseSpanshResult("40E0DDE2-D708-11F1-B356-DDEA54A60EFC", { status: "ok", parameters: { source: "Sol", body_types }, result: [sol] })!.url;
    expect(url(["Ammonia world"])).toContain("/ammonia/results/");
    expect(url(["Earth-like world"])).toContain("/earth/results/");
    expect(url(["Rocky body", "High metal content world"])).toContain("/rocky-metal/results/");
    expect(url()).toContain("/riches/results/");
  });

  it("asks Spansh once and says when the route is not ready or not there", async () => {
    const answer = (status: number, body: unknown) => async () => new Response(JSON.stringify(body), { status });
    const ok = await fetchSpanshRoute("AD7B6374-D6DF-11F1-9EF1-8B05C8FD45EC", answer(200, fx("neutron")) as typeof fetch);
    expect(ok.state === "ok" && ok.route.stops.length).toBe(4);
    expect(await fetchSpanshRoute("AD7B6374-D6DF-11F1-9EF1-8B05C8FD45EC", answer(200, { status: "queued" }) as typeof fetch)).toEqual({
      state: "pending",
      job: "AD7B6374-D6DF-11F1-9EF1-8B05C8FD45EC",
    });
    expect((await fetchSpanshRoute("AD7B6374-D6DF-11F1-9EF1-8B05C8FD45EC", answer(404, {}) as typeof fetch)).state).toBe("error");
    let asked = false;
    const none = await fetchSpanshRoute("no link here", (async () => {
      asked = true;
      return new Response("{}");
    }) as typeof fetch);
    expect(none.state).toBe("error");
    expect(asked).toBe(false);
  });
});

describe("the exact plotter's ends", () => {
  // Owner's Sol > Colonia export (2026-11-05): parameters name the ends by system address, the drawer showed the numbers.
  it("are named from the stops with those addresses", () => {
    const route = parseSpanshResult("0B004A0A-D929-11F1-A05B-E622D328DA96", {
      parameters: { source_system: "10477373803", destination_system: "3238296097059" },
      result: {
        jumps: [
          { name: "Sol", id64: "10477373803", x: 0, y: 0, z: 0, has_neutron: false, must_refuel: false, must_inject: 0 },
          { name: "Kigandan", id64: "11666070513065", x: 7.5625, y: -72.25, z: 10.75, has_neutron: false, must_refuel: true },
          { name: "Colonia", id64: "3238296097059", x: -9530.5, y: -910.28125, z: 19808.125, has_neutron: false },
        ],
      },
    });
    expect(route?.from).toBe("Sol");
    expect(route?.to).toBe("Colonia");
    expect(route?.stops[1]?.refuel).toBe(true);
  });

  it("stay as given when no stop has that address", () => {
    const route = parseSpanshResult("0B004A0A-D929-11F1-A05B-E622D328DA96", {
      parameters: { source_system: "123", destination_system: "Colonia" },
      result: { jumps: [{ name: "Sol", id64: "10477373803", x: 0, y: 0, z: 0 }, { name: "Colonia", x: 1, y: 1, z: 1 }] },
    });
    expect(route?.from).toBe("123");
    expect(route?.to).toBe("Colonia");
  });
});
