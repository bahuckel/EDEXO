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
