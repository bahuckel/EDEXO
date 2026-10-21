import { describe, expect, it } from "vitest";
import { inaraCommoditySearchUrl } from "../../src/shared/colonize/inaraLinks";

describe("inaraCommoditySearchUrl", () => {
  it("runs a buy search near the construction system using pa1[]", () => {
    const url = inaraCommoditySearchUrl("Titanium", "Sol");
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe("https://inara.cz/elite/commodities/");
    expect(u.searchParams.get("formbrief")).toBe("1");
    expect(u.searchParams.get("pi1")).toBe("1");
    expect(u.searchParams.get("ps1")).toBe("Sol");
    expect(u.searchParams.getAll("pa1[]")).toEqual(["48"]);
    expect(u.searchParams.get("pi2")).toBeNull();
    expect(u.searchParams.get("edexo")).toBe("1");
  });

  it("uses the construction system from opts, not a player location argument", () => {
    const url = inaraCommoditySearchUrl("Steel", "Shinrarta Dezhra", { nearSystem: "Swoilz PO-C b5-4" });
    const u = new URL(url);
    expect(u.searchParams.get("ps1")).toBe("Swoilz PO-C b5-4");
    expect(u.searchParams.getAll("pa1[]")).toEqual(["10487"]);
  });

  it("maps Liquid oxygen vs Water to different Inara ids", () => {
    const oxy = new URL(inaraCommoditySearchUrl("Liquid oxygen", "Sol"));
    const water = new URL(inaraCommoditySearchUrl("Water", "Sol"));
    expect(oxy.searchParams.getAll("pa1[]")).toEqual(["137"]);
    expect(water.searchParams.getAll("pa1[]")).toEqual(["139"]);
  });
});
