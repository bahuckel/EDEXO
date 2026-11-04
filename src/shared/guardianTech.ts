/**
 * Guardian technology for the Laboratory's Guardian tab (owner, 2026-11-01: "extend materials to guardian sites as
 * well, so it can be useful, the more the better"; 1.3.7): the Guardian materials and data, where each comes from,
 * and what the technology broker makes of them.
 *
 * - Recipes: the 29 Guardian technology broker unlocks as EDEngineer's blueprints have them (blueprints.json, type
 *   "Guardian", read 2026-11-03), ingredient names as the journals write them (EDEngineer's FormattedName, checked
 *   against the owner's own `Materials` lines). The game calls the blueprint data "fragments".
 * - Grades: EDEngineer's rarity (very common 1 … very rare 5); caps by grade 300 / 250 / 200 / 150 / 100.
 * - Sources: EDEngineer says "Ancient/Guardian ruins" for all of them; which part of a site gives what is the game's
 *   own (blueprint fragments from a structure's data terminal once its pylons are powered, obelisk data from the
 *   ruins' obelisks, sentinel parts from destroyed sentinels).
 * - Commodities (Magnetic Emitter Coil and the like) are bought at a market and carried as cargo: listed, not counted.
 */
import type { AlienSiteKind } from "./alienSites.js";

export type GuardianItemKind = "guardian" | "obelisk" | "blueprint" | "raw" | "manufactured" | "commodity";

export interface GuardianItem {
  /** The journal's name (lower case). */
  key: string;
  label: string;
  kind: GuardianItemKind;
  /** 1-5; null for commodities. */
  grade: 1 | 2 | 3 | 4 | 5 | null;
  /** Where it comes from, in the player's words. */
  source: string;
  /** The kinds of Guardian site that give it (the galaxy map's Guardian layer), empty when not a site's. */
  sites: readonly AlienSiteKind[];
}

const RUINS = "Guardian ruins and structures: picked up about the site";
export const GUARDIAN_ITEMS: readonly GuardianItem[] = [
  { key: "guardian_powercell", label: "Guardian Power Cell", kind: "guardian", grade: 1, source: RUINS, sites: ["ruins", "structure"] },
  { key: "guardian_sentinel_wreckagecomponents", label: "Guardian Wreckage Components", kind: "guardian", grade: 1, source: "Destroyed sentinels", sites: ["sentinel"] },
  { key: "guardian_powerconduit", label: "Guardian Power Conduit", kind: "guardian", grade: 2, source: RUINS, sites: ["ruins", "structure"] },
  { key: "guardian_techcomponent", label: "Guardian Technology Component", kind: "guardian", grade: 3, source: "Guardian structures: the destructible panels on the pillars", sites: ["structure"] },
  { key: "guardian_sentinel_weaponparts", label: "Guardian Sentinel Weapon Parts", kind: "guardian", grade: 3, source: "Destroyed sentinels", sites: ["sentinel"] },
  { key: "ancienthistoricaldata", label: "Pattern Gamma Obelisk Data", kind: "obelisk", grade: 1, source: "Guardian ruins: scan an obelisk with its artefact in the SRV", sites: ["ruins"] },
  { key: "ancientculturaldata", label: "Pattern Beta Obelisk Data", kind: "obelisk", grade: 2, source: "Guardian ruins: scan an obelisk with its artefact in the SRV", sites: ["ruins"] },
  { key: "ancientbiologicaldata", label: "Pattern Alpha Obelisk Data", kind: "obelisk", grade: 3, source: "Guardian ruins: scan an obelisk with its artefact in the SRV", sites: ["ruins"] },
  { key: "ancientlanguagedata", label: "Pattern Delta Obelisk Data", kind: "obelisk", grade: 4, source: "Guardian ruins: scan an obelisk with its artefact in the SRV", sites: ["ruins"] },
  { key: "ancienttechnologicaldata", label: "Pattern Epsilon Obelisk Data", kind: "obelisk", grade: 5, source: "Guardian ruins: scan an obelisk with its artefact in the SRV", sites: ["ruins"] },
  { key: "guardian_moduleblueprint", label: "Guardian Module Blueprint Fragment", kind: "blueprint", grade: 5, source: "A Guardian structure's data terminal, once its pylons are powered (module sites)", sites: ["structure"] },
  { key: "guardian_weaponblueprint", label: "Guardian Weapon Blueprint Fragment", kind: "blueprint", grade: 5, source: "A Guardian structure's data terminal, once its pylons are powered (weapon sites)", sites: ["structure"] },
  { key: "guardian_vesselblueprint", label: "Guardian Vessel Blueprint Fragment", kind: "blueprint", grade: 5, source: "A Guardian structure's data terminal, opened with a beacon's key (vessel sites)", sites: ["structure", "beacon"] },
  { key: "manganese", label: "Manganese", kind: "raw", grade: 2, source: "Surface prospecting, most landable bodies", sites: [] },
  { key: "chromium", label: "Chromium", kind: "raw", grade: 2, source: "Surface prospecting, most landable bodies", sites: [] },
  { key: "carbon", label: "Carbon", kind: "raw", grade: 1, source: "Surface prospecting, most landable bodies", sites: [] },
  { key: "niobium", label: "Niobium", kind: "raw", grade: 3, source: "Surface prospecting (the Laboratory's Jumponium tab finds it)", sites: [] },
  { key: "germanium", label: "Germanium", kind: "raw", grade: 2, source: "Surface prospecting (the Laboratory's Jumponium tab finds it)", sites: [] },
  { key: "arsenic", label: "Arsenic", kind: "raw", grade: 2, source: "Surface prospecting (the Laboratory's Jumponium tab finds it)", sites: [] },
  { key: "focuscrystals", label: "Focus Crystals", kind: "manufactured", grade: 3, source: "Ship salvage, high-grade emission signals, trading", sites: [] },
  { key: "phasealloys", label: "Phase Alloys", kind: "manufactured", grade: 3, source: "Ship salvage, high-grade emission signals, trading", sites: [] },
  { key: "heatresistantceramics", label: "Heat Resistant Ceramics", kind: "manufactured", grade: 2, source: "Ship salvage, settlements, trading", sites: [] },
  { key: "magneticemittercoil", label: "Magnetic Emitter Coil", kind: "commodity", grade: null, source: "Bought at a market", sites: [] },
  { key: "reinforcedmountingplate", label: "Reinforced Mounting Plate", kind: "commodity", grade: null, source: "Bought at a market", sites: [] },
  { key: "micro-weavecoolinghoses", label: "Micro-Weave Cooling Hoses", kind: "commodity", grade: null, source: "Bought at a market", sites: [] },
  { key: "articulationmotors", label: "Articulation Motors", kind: "commodity", grade: null, source: "Bought at a market", sites: [] },
  { key: "powergridassembly", label: "Energy Grid Assembly", kind: "commodity", grade: null, source: "Bought at a market", sites: [] },
  { key: "hnshockmount", label: "HN Shock Mount", kind: "commodity", grade: null, source: "Bought at a market", sites: [] },
  { key: "heatsinkinterlink", label: "Heatsink Interlink", kind: "commodity", grade: null, source: "Bought at a market", sites: [] },
  { key: "diagnosticsensor", label: "Hardware Diagnostic Sensor", kind: "commodity", grade: null, source: "Bought at a market", sites: [] },
  { key: "microcontrollers", label: "Micro Controllers", kind: "commodity", grade: null, source: "Bought at a market", sites: [] },
  { key: "powertransferconduits", label: "Power Transfer Bus", kind: "commodity", grade: null, source: "Bought at a market", sites: [] },
  { key: "thermalcoolingunits", label: "Thermal Cooling Units", kind: "commodity", grade: null, source: "Bought at a market", sites: [] },
  { key: "powerconverter", label: "Power Converter", kind: "commodity", grade: null, source: "Bought at a market", sites: [] },
];

const BY_KEY = new Map(GUARDIAN_ITEMS.map((i) => [i.key, i]));
export const guardianItem = (key: string): GuardianItem | undefined => BY_KEY.get(key);

/** Material caps by grade (manufactured and encoded). */
export const MAT_CAP: Record<1 | 2 | 3 | 4 | 5, number> = { 1: 300, 2: 250, 3: 200, 4: 150, 5: 100 };

/** The Guardian materials and data the game counts as materials (the Laboratory's stock line). */
export const GUARDIAN_STOCK: readonly GuardianItem[] = GUARDIAN_ITEMS.filter((i) => i.kind === "guardian" || i.kind === "obelisk" || i.kind === "blueprint");

export type GuardianGroup = "module" | "weapon" | "fighter";
export interface GuardianRecipe {
  name: string;
  group: GuardianGroup;
  /** Journal name → how many. */
  needs: Readonly<Record<string, number>>;
}

export const GUARDIAN_RECIPES: readonly GuardianRecipe[] = [
  { name: "Guardian FSD Booster", group: "module", needs: { guardian_moduleblueprint: 1, guardian_powercell: 21, guardian_techcomponent: 21, focuscrystals: 24, hnshockmount: 8 } },
  { name: "Guardian Hybrid Power Plant", group: "module", needs: { guardian_moduleblueprint: 1, guardian_powerconduit: 18, ancienttechnologicaldata: 21, heatresistantceramics: 15, powergridassembly: 10 } },
  { name: "Guardian Power Distributor", group: "module", needs: { guardian_moduleblueprint: 1, ancientbiologicaldata: 20, guardian_powercell: 24, phasealloys: 18, heatsinkinterlink: 6 } },
  { name: "Guardian Shield Reinforcement", group: "module", needs: { guardian_moduleblueprint: 1, guardian_powercell: 17, guardian_techcomponent: 20, ancientlanguagedata: 24, diagnosticsensor: 8 } },
  { name: "Guardian Hull Reinforcement", group: "module", needs: { guardian_moduleblueprint: 1, guardian_sentinel_wreckagecomponents: 21, ancientculturaldata: 16, ancienthistoricaldata: 16, reinforcedmountingplate: 12 } },
  { name: "Guardian Module Reinforcement", group: "module", needs: { guardian_moduleblueprint: 1, guardian_sentinel_wreckagecomponents: 18, ancienttechnologicaldata: 15, guardian_powerconduit: 20, reinforcedmountingplate: 9 } },
  { name: "Guardian Gauss Cannon (Fixed, Small)", group: "weapon", needs: { guardian_weaponblueprint: 1, guardian_powerconduit: 12, guardian_sentinel_wreckagecomponents: 12, guardian_sentinel_weaponparts: 15 } },
  { name: "Guardian Gauss Cannon (Fixed, Medium)", group: "weapon", needs: { guardian_weaponblueprint: 1, guardian_powercell: 18, guardian_techcomponent: 20, manganese: 15, magneticemittercoil: 6 } },
  { name: "Guardian Plasma Charger (Fixed, Small)", group: "weapon", needs: { guardian_weaponblueprint: 1, guardian_powercell: 12, guardian_sentinel_weaponparts: 12, guardian_techcomponent: 15 } },
  { name: "Guardian Plasma Charger (Fixed, Medium)", group: "weapon", needs: { guardian_weaponblueprint: 1, guardian_powerconduit: 19, guardian_sentinel_weaponparts: 16, chromium: 14, "micro-weavecoolinghoses": 8 } },
  { name: "Guardian Plasma Charger (Fixed, Large)", group: "weapon", needs: { guardian_weaponblueprint: 1, guardian_powerconduit: 28, guardian_sentinel_weaponparts: 20, chromium: 28, "micro-weavecoolinghoses": 10 } },
  { name: "Guardian Plasma Charger (Turreted, Small)", group: "weapon", needs: { guardian_weaponblueprint: 1, guardian_powercell: 12, guardian_techcomponent: 12, guardian_sentinel_weaponparts: 15 } },
  { name: "Guardian Plasma Charger (Turreted, Medium)", group: "weapon", needs: { guardian_weaponblueprint: 2, guardian_powerconduit: 21, guardian_sentinel_weaponparts: 20, chromium: 16, articulationmotors: 8 } },
  { name: "Guardian Plasma Charger (Turreted, Large)", group: "weapon", needs: { guardian_weaponblueprint: 2, guardian_powerconduit: 26, guardian_sentinel_weaponparts: 24, chromium: 26, articulationmotors: 10 } },
  { name: "Guardian Shard Cannon (Fixed, Small)", group: "weapon", needs: { guardian_weaponblueprint: 1, guardian_powerconduit: 12, guardian_techcomponent: 12, guardian_sentinel_weaponparts: 15 } },
  { name: "Guardian Shard Cannon (Fixed, Medium)", group: "weapon", needs: { guardian_techcomponent: 18, guardian_weaponblueprint: 1, guardian_sentinel_wreckagecomponents: 20, carbon: 14, powertransferconduits: 12 } },
  { name: "Guardian Shard Cannon (Fixed, Large)", group: "weapon", needs: { guardian_techcomponent: 28, guardian_weaponblueprint: 1, guardian_sentinel_wreckagecomponents: 20, carbon: 20, microcontrollers: 18 } },
  { name: "Guardian Shard Cannon (Turreted, Small)", group: "weapon", needs: { guardian_weaponblueprint: 1, guardian_powerconduit: 12, guardian_sentinel_weaponparts: 12, guardian_techcomponent: 15 } },
  { name: "Guardian Shard Cannon (Turreted, Medium)", group: "weapon", needs: { guardian_weaponblueprint: 2, guardian_sentinel_wreckagecomponents: 16, guardian_techcomponent: 20, carbon: 15, microcontrollers: 12 } },
  { name: "Guardian Shard Cannon (Turreted, Large)", group: "weapon", needs: { guardian_weaponblueprint: 2, guardian_sentinel_wreckagecomponents: 20, guardian_techcomponent: 26, carbon: 28, microcontrollers: 12 } },
  { name: "Modified Gauss Cannon (Fixed, Small)", group: "weapon", needs: { guardian_weaponblueprint: 1, guardian_powerconduit: 3, guardian_sentinel_wreckagecomponents: 3, guardian_sentinel_weaponparts: 4, niobium: 2 } },
  { name: "Modified Gauss Cannon (Fixed, Medium)", group: "weapon", needs: { guardian_weaponblueprint: 1, guardian_powercell: 5, guardian_techcomponent: 5, niobium: 4, thermalcoolingunits: 2 } },
  { name: "Modified Plasma Charger (Fixed, Small)", group: "weapon", needs: { guardian_weaponblueprint: 1, guardian_powercell: 3, guardian_techcomponent: 4, guardian_sentinel_weaponparts: 3, arsenic: 2 } },
  { name: "Modified Plasma Charger (Fixed, Medium)", group: "weapon", needs: { guardian_powerconduit: 5, guardian_weaponblueprint: 1, guardian_sentinel_weaponparts: 5, arsenic: 4, powertransferconduits: 2 } },
  { name: "Modified Shard Cannon (Fixed, Small)", group: "weapon", needs: { guardian_weaponblueprint: 1, guardian_powerconduit: 3, guardian_sentinel_wreckagecomponents: 3, guardian_sentinel_weaponparts: 4, germanium: 2 } },
  { name: "Modified Shard Cannon (Fixed, Medium)", group: "weapon", needs: { guardian_techcomponent: 5, guardian_weaponblueprint: 1, guardian_sentinel_wreckagecomponents: 5, germanium: 4, powerconverter: 2 } },
  { name: "Javelin (Fighter)", group: "fighter", needs: { guardian_powercell: 25, guardian_sentinel_wreckagecomponents: 18, guardian_vesselblueprint: 1, ancienttechnologicaldata: 26, guardian_techcomponent: 25 } },
  { name: "Lance (Fighter)", group: "fighter", needs: { guardian_powercell: 25, guardian_sentinel_weaponparts: 18, guardian_vesselblueprint: 1, ancienttechnologicaldata: 26, guardian_techcomponent: 25 } },
  { name: "Trident (Fighter)", group: "fighter", needs: { guardian_powercell: 25, guardian_vesselblueprint: 1, ancienttechnologicaldata: 26, ancientculturaldata: 18, guardian_techcomponent: 25 } },
];

export const GUARDIAN_GROUP_NAME: Record<GuardianGroup, string> = { module: "Modules", weapon: "Weapons", fighter: "Fighters" };

export interface GuardianNeedDTO {
  key: string;
  label: string;
  kind: GuardianItemKind;
  qty: number;
  /** Aboard; null for commodities (cargo, not counted here). */
  held: number | null;
}

export interface GuardianRecipeDTO {
  name: string;
  group: GuardianGroup;
  /** How many the materials aboard unlock (commodities left out: bought at a market). */
  count: number;
  needs: GuardianNeedDTO[];
  /** What one more needs beyond what is aboard (commodities left out), as the Jumponium tiers' `short`. */
  short: { key: string; label: string; need: number }[];
}

export interface GuardianStockDTO {
  key: string;
  label: string;
  kind: GuardianItemKind;
  count: number;
  cap: number;
  source: string;
  sites: readonly AlienSiteKind[];
  /** Recipes that take it. */
  usedBy: number;
}

export interface GuardianLabDTO {
  stock: GuardianStockDTO[];
  recipes: GuardianRecipeDTO[];
}

/** What the materials aboard make of each Guardian unlock; `raw` and `mats` are the Laboratory's counts. */
export function guardianLabView(raw: Readonly<Record<string, number>> | null, mats: Readonly<Record<string, number>> | null): GuardianLabDTO {
  const held = (key: string): number | null => {
    const it = guardianItem(key);
    if (!it || it.kind === "commodity") return null;
    return (it.kind === "raw" ? raw?.[key] : mats?.[key]) ?? 0;
  };
  return {
    stock: GUARDIAN_STOCK.map((i) => ({
      key: i.key,
      label: i.label,
      kind: i.kind,
      count: held(i.key) ?? 0,
      cap: MAT_CAP[i.grade ?? 5],
      source: i.source,
      sites: i.sites,
      usedBy: GUARDIAN_RECIPES.filter((r) => i.key in r.needs).length,
    })),
    recipes: GUARDIAN_RECIPES.map((r) => {
      const needs = Object.entries(r.needs).map(([key, qty]) => {
        const it = guardianItem(key)!;
        return { key, label: it.label, kind: it.kind, qty, held: held(key) };
      });
      let count = Number.POSITIVE_INFINITY;
      for (const n of needs) if (n.held != null) count = Math.min(count, Math.floor(n.held / n.qty));
      if (!Number.isFinite(count)) count = 0;
      const short = needs.flatMap((n) => {
        const need = n.held == null ? 0 : (count + 1) * n.qty - n.held;
        return need > 0 ? [{ key: n.key, label: n.label, need }] : [];
      });
      return { name: r.name, group: r.group, count, needs, short };
    }),
  };
}
