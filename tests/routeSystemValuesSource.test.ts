/**
 * Which record values a route system (2026-11-03, the tour's Spansh route from Sol): the commander's own records,
 * unless Spansh knows more bodies with biology there. Blatrimpe, passed through with one body scanned, said 35 M where
 * Spansh's seven bodies hold 122 M; a system he scanned whole is answered from his records without asking Spansh.
 */
import type { AddressInfo } from "node:net";
import express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RouteSystemBodyDTO, RouteSystemValuesDTO } from "../src/shared/dto/routeSystem.js";

const body = (name: string, bioCr: number | null, bioSignals: number | null = bioCr ? 1 : null): RouteSystemBodyDTO => ({
  name, tag: null, fssCr: 0, dssCr: null, bioSignals, bioCr, species: [], codexNew: 0, codexFirst: 0,
});
const sys = (source: string, bodies: RouteSystemBodyDTO[], total: number | null, missing: number): RouteSystemValuesDTO =>
  ({
    addr: "7505623126738", name: "Blatrimpe", state: "ok", source, bodyCount: bodies.length, bodyTotal: total, missing,
    fssCr: 0, dssCr: 0, dssBodies: 0, totalCr: 0, bioCr: bodies.reduce((a, b) => a + (b.bioCr ?? 0), 0),
    codexNew: 0, codexFirst: 0, bodies, fetchedAt: null,
  }) as RouteSystemValuesDTO;

let own: RouteSystemValuesDTO | null = null;
let spansh: RouteSystemValuesDTO;
let asked = 0;
vi.mock("../src/server/scanRouteView.js", () => ({
  journalSystemValues: () => own,
  journalScanRoute: () => null,
  spanshScanRoute: () => null,
}));
vi.mock("../src/server/routeSystemValues.js", () => ({
  createRouteSystemValues: () => ({
    values: async () => {
      asked++;
      return spansh;
    },
    system: async () => ({ none: "" }),
  }),
}));
const { registerRouteSystemRoutes } = await import("../src/server/routes/routeSystemRoutes.js");

afterEach(() => {
  asked = 0;
});

async function ask(): Promise<RouteSystemValuesDTO> {
  const app = express();
  registerRouteSystemRoutes(app, { getJournalStore: () => ({}) } as never);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  try {
    const port = (server.address() as AddressInfo).port;
    return (await (await fetch(`http://127.0.0.1:${port}/api/route/system-values?addr=7505623126738&name=Blatrimpe`)).json()) as RouteSystemValuesDTO;
  } finally {
    server.close();
  }
}

describe("a route system's values", () => {
  const sevenBodies = ["12 d", "12 c", "12 b", "14 a", "14 c", "14 d", "14 e"].map((b) => body(`Blatrimpe ${b}`, 17_000_000));

  it("are Spansh's where it knows more bodies with biology than his records", async () => {
    own = sys("journal", [body("Blatrimpe 14 e", 35_275_300)], 30, 25);
    spansh = sys("spansh", sevenBodies, 30, 0);
    expect((await ask()).source).toBe("spansh");
  });

  it("are his own where they know as many, and Spansh is not asked for a system he scanned whole", async () => {
    own = sys("journal", sevenBodies, 30, 4);
    expect((await ask()).source).toBe("journal");
    expect(asked).toBe(1);
    own = sys("journal", [body("Blatrimpe 14 e", 35_275_300)], 30, 0);
    expect((await ask()).source).toBe("journal");
    expect(asked).toBe(1);
  });

  it("are Spansh's for a system he never scanned", async () => {
    own = null;
    spansh = sys("spansh", sevenBodies, 30, 0);
    expect((await ask()).source).toBe("spansh");
  });
});
