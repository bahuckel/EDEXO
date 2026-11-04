/**
 * The Laboratory's Guardian tab (1.3.7): manufactured and encoded materials counted from the journals beside the raw
 * ones, and what they unlock at a Guardian technology broker (shared/guardianTech.ts).
 */
import { describe, expect, it } from "vitest";
import { GUARDIAN_ITEMS, GUARDIAN_RECIPES, guardianItem, guardianLabView } from "../src/shared/guardianTech.js";
import { hydrateJumponium, jumponiumLine, jumponiumView, newJumponium } from "../src/shared/jumponium.js";

const login = {
  event: "Materials",
  timestamp: "2026-11-01T16:52:25Z",
  Raw: [{ Name: "manganese", Count: 40 }],
  Manufactured: [
    { Name: "guardian_powercell", Name_Localised: "Guardian Power Cell", Count: 69 },
    { Name: "guardian_techcomponent", Name_Localised: "Guardian Technology Component", Count: 3 },
    { Name: "focuscrystals", Name_Localised: "Focus Crystals", Count: 42 },
  ],
  Encoded: [{ Name: "guardian_moduleblueprint", Name_Localised: "Guardian Module Blueprint Fragment", Count: 1 }],
};

describe("Guardian technology", () => {
  it("every recipe ingredient is a known item, every recipe needs a blueprint fragment", () => {
    expect(GUARDIAN_RECIPES).toHaveLength(29);
    for (const r of GUARDIAN_RECIPES) {
      for (const k of Object.keys(r.needs)) expect(guardianItem(k), `${r.name}: ${k}`).toBeDefined();
      expect(Object.keys(r.needs).some((k) => guardianItem(k)!.kind === "blueprint"), r.name).toBe(true);
    }
    expect(new Set(GUARDIAN_ITEMS.map((i) => i.key)).size).toBe(GUARDIAN_ITEMS.length);
  });

  it("counts manufactured and encoded materials from the login list and the events after it", () => {
    const st = newJumponium();
    jumponiumLine(st, login);
    expect(st.mats).toMatchObject({ guardian_powercell: 69, guardian_moduleblueprint: 1 });
    jumponiumLine(st, { event: "MaterialCollected", Category: "Manufactured", Name: "guardian_techcomponent", Count: 3 });
    jumponiumLine(st, { event: "MaterialCollected", Category: "Encoded", Name: "ancienttechnologicaldata", Count: 6 });
    jumponiumLine(st, {
      event: "MaterialTrade",
      Paid: { Material: "guardian_powercell", Category: "Manufactured", Quantity: 6 },
      Received: { Material: "guardian_techcomponent", Category: "Manufactured", Quantity: 1 },
    });
    expect(st.mats).toMatchObject({ guardian_powercell: 63, guardian_techcomponent: 7, ancienttechnologicaldata: 6 });
    // The broker takes manufactured, encoded and raw alike; raw stays in `raw`.
    jumponiumLine(st, {
      event: "TechnologyBroker",
      Materials: [
        { Name: "guardian_powercell", Count: 21, Category: "Manufactured" },
        { Name: "guardian_moduleblueprint", Count: 1, Category: "Encoded" },
        { Name: "manganese", Count: 15, Category: "Raw" },
      ],
    });
    expect(st.mats).toMatchObject({ guardian_powercell: 42, guardian_moduleblueprint: 0 });
    expect(st.raw).toMatchObject({ manganese: 25 });
    expect(st.mats!.manganese).toBeUndefined();
    // A cap by grade (power cells are grade 1: 300).
    jumponiumLine(st, { event: "MaterialCollected", Category: "Manufactured", Name: "guardian_powercell", Count: 1000 });
    expect(st.mats!.guardian_powercell).toBe(300);
  });

  it("says what the materials aboard unlock, commodities left out of the count", () => {
    const view = guardianLabView({ manganese: 40 }, { guardian_moduleblueprint: 2, guardian_powercell: 50, guardian_techcomponent: 45, focuscrystals: 24 });
    const fsd = view.recipes.find((r) => r.name === "Guardian FSD Booster")!;
    expect(fsd.count).toBe(1);
    expect(fsd.needs.find((n) => n.key === "hnshockmount")).toMatchObject({ kind: "commodity", held: null });
    // What a second lacks: only the focus crystals (commodities are never short, they are bought).
    expect(fsd.short).toEqual([{ key: "focuscrystals", label: "Focus Crystals", need: 24 }]);
    const shield = view.recipes.find((r) => r.name === "Guardian Shield Reinforcement")!;
    expect(shield.count).toBe(0);
    expect(view.stock.find((s) => s.key === "guardian_powercell")).toMatchObject({ count: 50, cap: 300 });
  });

  it("keeps the counts through the merge cache, and says when they are not known yet", () => {
    const st = newJumponium();
    expect(jumponiumView(st).matsKnown).toBe(false);
    jumponiumLine(st, login);
    const back = hydrateJumponium(JSON.parse(JSON.stringify(st)));
    expect(back.mats).toEqual(st.mats);
    expect(jumponiumView(back).matsKnown).toBe(true);
    expect(jumponiumView(back).guardian.stock.find((s) => s.key === "guardian_techcomponent")!.count).toBe(3);
  });
});
