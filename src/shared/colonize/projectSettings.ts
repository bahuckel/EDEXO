/**
 * Settings that belong to one construction site (discuss items 1 and 9, owner 2026-10-23): its own plan rules (pad,
 * distance, planet ports, other carriers), its own "systems per material", and which site the HUD follows. The hub
 * pin stays where it was (KEY_DEPOT_REF_PINS); routing, live scans, bans and the hold override stay global - they
 * are about the commander and his ship, not the site.
 *
 * One plan still serves every active site (a trip can deliver to two), so it runs under the strictest rules of them
 * all: any seller it picks is fine for every site a trip may unload at.
 */
import type { MinLandingPad } from "./stationFilter";

export type SiteRules = {
  minLandingPad?: MinLandingPad;
  /** Ly, as typed; "" = any. */
  maxDistanceLy?: string;
  showPlanetary?: boolean;
  excludeFleetCarriers?: boolean;
};

export type ProjectSettings = {
  rules?: SiteRules;
  /** As typed, like the global setting; "" or absent = the global one. */
  maxSystemsPerMaterial?: string;
};

/** By the site's market id. */
export type ProjectSettingsMap = Record<string, ProjectSettings>;

const PADS = new Set(["any", "M", "L"]);

function parseRules(raw: unknown): SiteRules | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const out: SiteRules = {};
  if (typeof r.minLandingPad === "string" && PADS.has(r.minLandingPad)) out.minLandingPad = r.minLandingPad as MinLandingPad;
  if (typeof r.maxDistanceLy === "string") out.maxDistanceLy = r.maxDistanceLy.replace(/[^\d.]/g, "");
  if (typeof r.showPlanetary === "boolean") out.showPlanetary = r.showPlanetary;
  if (typeof r.excludeFleetCarriers === "boolean") out.excludeFleetCarriers = r.excludeFleetCarriers;
  return Object.keys(out).length ? out : undefined;
}

export function parseProjectSettings(raw: unknown): ProjectSettingsMap | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: ProjectSettingsMap = {};
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!id || !v || typeof v !== "object") continue;
    const o = v as Record<string, unknown>;
    const p: ProjectSettings = {};
    const rules = parseRules(o.rules);
    if (rules) p.rules = rules;
    if (typeof o.maxSystemsPerMaterial === "string" && o.maxSystemsPerMaterial.trim())
      p.maxSystemsPerMaterial = o.maxSystemsPerMaterial.replace(/[^\d]/g, "");
    if (Object.keys(p).length) out[id] = p;
  }
  return out;
}

/** Drops what equals nothing (an empty rules object, a blank cap) so the stored map stays small. */
export function withProject(map: ProjectSettingsMap, marketId: string, next: ProjectSettings | null): ProjectSettingsMap {
  const out = { ...map };
  const rules = next?.rules && Object.keys(next.rules).length ? next.rules : undefined;
  const cap = next?.maxSystemsPerMaterial?.trim() ? next.maxSystemsPerMaterial.trim() : undefined;
  if (!rules && !cap) delete out[marketId];
  else out[marketId] = { ...(rules ? { rules } : {}), ...(cap ? { maxSystemsPerMaterial: cap } : {}) };
  return out;
}

type RuleSet = { minLandingPad: MinLandingPad; maxDistanceLy: string; showPlanetary: boolean; excludeFleetCarriers: boolean };

const PAD_RANK: Record<MinLandingPad, number> = { any: 0, M: 1, L: 2 };

/**
 * The plan's rules under every active site's own: the biggest pad asked, the shortest distance, planet ports only if
 * every site allows them, other carriers only if every site does. `stricterFor` names the sites that tightened it.
 */
export function strictestRules<T extends RuleSet>(
  base: T,
  sites: { label: string; rules: SiteRules | undefined }[],
): { rules: T; stricterFor: string[] } {
  let out: T = { ...base };
  const stricterFor: string[] = [];
  for (const s of sites) {
    const r = s.rules;
    if (!r) continue;
    const before = out;
    if (r.minLandingPad && PAD_RANK[r.minLandingPad] > PAD_RANK[out.minLandingPad]) out = { ...out, minLandingPad: r.minLandingPad };
    const ly = Number(r.maxDistanceLy);
    const cur = Number(out.maxDistanceLy);
    if (r.maxDistanceLy && ly > 0 && (!out.maxDistanceLy || !(cur > 0) || ly < cur)) out = { ...out, maxDistanceLy: r.maxDistanceLy };
    if (r.showPlanetary === false && out.showPlanetary) out = { ...out, showPlanetary: false };
    if (r.excludeFleetCarriers === true && !out.excludeFleetCarriers) out = { ...out, excludeFleetCarriers: true };
    if (out !== before) stricterFor.push(s.label);
  }
  return { rules: out, stricterFor };
}

/** Each site's own "systems per material", by its reference system in lower case (the scan's key). */
export function capsByReference(
  sites: { marketId: string; reference: string }[],
  projects: ProjectSettingsMap,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of sites) {
    const n = Number(projects[s.marketId]?.maxSystemsPerMaterial);
    const ref = s.reference.trim().toLowerCase();
    if (!ref || !(n > 0)) continue;
    // Two sites round one hub: the bigger cap, so neither stops short.
    out[ref] = Math.max(out[ref] ?? 0, Math.floor(n));
  }
  return out;
}

/**
 * The site the HUD follows (discuss item 9): docked at one wins (it is what can be acted on), then the pinned one if
 * it is still being built, then where the next trip delivers, then the most recent.
 */
export function followedSiteId(args: {
  dockedId: string | null;
  pinnedId: string | null;
  tripSiteId: string | null;
  activeIds: string[];
}): string | null {
  const active = new Set(args.activeIds);
  if (args.dockedId && active.has(args.dockedId)) return args.dockedId;
  if (args.pinnedId && active.has(args.pinnedId)) return args.pinnedId;
  if (args.tripSiteId && active.has(args.tripSiteId)) return args.tripSiteId;
  return args.activeIds[0] ?? null;
}
