/**
 * The commander's own notable-body rules (owner, 2026-11-02: "Notable bodies rules - yes", from the Observatory
 * Explorer idea in the 2026-11-02 survey of other Elite apps). The body features (bodyFeatures.ts) are a fixed list
 * with fixed thresholds; a rule is his own: a name and up to six conditions on the body's scan, all of which must hold
 * ("landable, gravity under 0.05 g, atmosphere contains argon"). A body that meets one shows on the Notable card and
 * the system map with the rule's name and the figures that met it, and a new scan of one comes to the mail icon, as a
 * ticked feature does.
 *
 * Scan facts only, so a rule is decided the moment the body is scanned. Units are the ones the app shows (g, K, atm,
 * km, ls, days, degrees); the journal's (m/s², Pa, m, s) are converted here.
 */
import type { ExplorationScanRecord } from "./dto/scan.js";

export type RuleField =
  | "planetClass"
  | "starType"
  | "landable"
  | "terraformable"
  | "atmosphere"
  | "volcanism"
  | "gravityG"
  | "temperatureK"
  | "pressureAtm"
  | "radiusKm"
  | "massEM"
  | "distanceLs"
  | "rings"
  | "orbitDays"
  | "eccentricity"
  | "inclinationDeg"
  | "tidalLock";

export type RuleFieldKind = "number" | "text" | "flag";

/** Numbers compare; text contains or not ("none" matches no atmosphere / volcanism); flags are yes or no. */
export type RuleOp = "lt" | "le" | "ge" | "gt" | "has" | "lacks" | "yes" | "no";

export interface RuleCondition {
  field: RuleField;
  op: RuleOp;
  /** A number for number fields, text for text fields; unused for flags. */
  value?: number | string;
}

export interface CustomBodyRule {
  id: string;
  name: string;
  on: boolean;
  conds: RuleCondition[];
}

export interface RuleFieldDef {
  key: RuleField;
  label: string;
  kind: RuleFieldKind;
  unit?: string;
}

export const RULE_FIELDS: readonly RuleFieldDef[] = [
  { key: "planetClass", label: "Planet class", kind: "text" },
  { key: "starType", label: "Star type", kind: "text" },
  { key: "landable", label: "Landable", kind: "flag" },
  { key: "terraformable", label: "Terraformable", kind: "flag" },
  { key: "atmosphere", label: "Atmosphere", kind: "text" },
  { key: "volcanism", label: "Volcanism", kind: "text" },
  { key: "gravityG", label: "Gravity", kind: "number", unit: "g" },
  { key: "temperatureK", label: "Temperature", kind: "number", unit: "K" },
  { key: "pressureAtm", label: "Pressure", kind: "number", unit: "atm" },
  { key: "radiusKm", label: "Radius", kind: "number", unit: "km" },
  { key: "massEM", label: "Mass", kind: "number", unit: "Earth masses" },
  { key: "distanceLs", label: "Distance from arrival", kind: "number", unit: "ls" },
  { key: "rings", label: "Rings", kind: "number", unit: "rings" },
  { key: "orbitDays", label: "Orbital period", kind: "number", unit: "days" },
  { key: "eccentricity", label: "Eccentricity", kind: "number" },
  { key: "inclinationDeg", label: "Inclination", kind: "number", unit: "°" },
  { key: "tidalLock", label: "Tidally locked", kind: "flag" },
];

export const RULE_OPS: Record<RuleFieldKind, readonly { key: RuleOp; label: string }[]> = {
  number: [
    { key: "lt", label: "under" },
    { key: "le", label: "at most" },
    { key: "ge", label: "at least" },
    { key: "gt", label: "over" },
  ],
  text: [
    { key: "has", label: "contains" },
    { key: "lacks", label: "does not contain" },
  ],
  flag: [
    { key: "yes", label: "yes" },
    { key: "no", label: "no" },
  ],
};

export const MAX_RULES = 20;
export const MAX_CONDS = 6;
const MAX_NAME = 40;
const MAX_TEXT = 40;

const FIELD = new Map(RULE_FIELDS.map((f) => [f.key, f]));

export function ruleFieldDef(key: RuleField): RuleFieldDef | undefined {
  return FIELD.get(key);
}

/** The scan fields a rule reads. Journal units: metres, seconds, m/s², pascals. */
export type RuleRecord = Partial<
  Pick<
    ExplorationScanRecord,
    | "planetClass"
    | "starType"
    | "landable"
    | "terraformState"
    | "atmosphere"
    | "volcanism"
    | "surfaceGravity"
    | "surfaceTemperature"
    | "surfacePressure"
    | "radius"
    | "massEM"
    | "distanceFromArrivalLs"
    | "rings"
    | "orbitalPeriod"
    | "eccentricity"
    | "orbitalInclination"
    | "tidalLock"
  >
>;

const G0 = 9.80665;
const ATM_PA = 101_325;

/** The field's value in the app's units: number, text (lower case; "" for none) or flag; undefined when unknown. */
function valueOf(r: RuleRecord, f: RuleField): number | string | boolean | undefined {
  const n = (v: number | undefined, k = 1) => (typeof v === "number" && Number.isFinite(v) ? v * k : undefined);
  switch (f) {
    case "planetClass":
      return r.planetClass?.trim().toLowerCase();
    case "starType":
      return r.starType?.trim().toLowerCase();
    case "landable":
      return r.landable;
    case "terraformable":
      return r.terraformState == null ? (r.planetClass ? false : undefined) : /terraform/i.test(r.terraformState) && !/^terraformed$/i.test(r.terraformState.trim());
    case "atmosphere":
      return r.atmosphere == null ? undefined : r.atmosphere.trim().toLowerCase();
    case "volcanism":
      return r.volcanism == null ? undefined : r.volcanism.trim().toLowerCase();
    case "gravityG":
      return n(r.surfaceGravity, 1 / G0);
    case "temperatureK":
      return n(r.surfaceTemperature);
    case "pressureAtm":
      return n(r.surfacePressure, 1 / ATM_PA);
    case "radiusKm":
      return n(r.radius, 1 / 1000);
    case "massEM":
      return n(r.massEM);
    case "distanceLs":
      return n(r.distanceFromArrivalLs);
    case "rings":
      return r.rings ? r.rings.length : r.planetClass || r.starType ? 0 : undefined;
    case "orbitDays":
      return r.orbitalPeriod == null ? undefined : n(Math.abs(r.orbitalPeriod), 1 / 86_400);
    case "eccentricity":
      return n(r.eccentricity);
    case "inclinationDeg":
      return r.orbitalInclination == null ? undefined : n(Math.abs(r.orbitalInclination));
    case "tidalLock":
      return r.tidalLock;
  }
}

function fmt(v: number): string {
  const a = Math.abs(v);
  return v.toLocaleString("en-US", { maximumFractionDigits: a >= 100 ? 0 : a >= 1 ? 2 : 3 });
}

/** Whether one condition holds, and the figure that made it so ("0.04 g"); null when it does not or is unknown. */
function check(r: RuleRecord, c: RuleCondition): string | null {
  const def = FIELD.get(c.field);
  if (!def) return null;
  const v = valueOf(r, c.field);
  if (v === undefined) return null;
  if (def.kind === "flag") {
    const want = c.op === "yes";
    return v === want ? (want ? def.label : `not ${def.label.toLowerCase()}`) : null;
  }
  if (def.kind === "text") {
    const s = String(v);
    const needle = String(c.value ?? "").trim().toLowerCase();
    // "none" is the empty atmosphere / volcanism: the journal writes "".
    const has = needle === "none" ? s === "" : !!needle && s.includes(needle);
    if (c.op === "has" ? !has : has) return null;
    return `${def.label} ${s || "none"}`;
  }
  const x = typeof v === "number" ? v : NaN;
  const t = typeof c.value === "number" ? c.value : NaN;
  if (!Number.isFinite(x) || !Number.isFinite(t)) return null;
  const ok = c.op === "lt" ? x < t : c.op === "le" ? x <= t : c.op === "ge" ? x >= t : c.op === "gt" ? x > t : false;
  return ok ? `${def.label} ${fmt(x)}${def.unit ? ` ${def.unit}` : ""}` : null;
}

export type RuleKey = `rule:${string}`;

export interface RuleHit {
  key: RuleKey;
  label: string;
  why: string;
}

/** The rules a body meets, switched-on rules with at least one condition only, in the list's order. */
export function customRuleHits(r: RuleRecord, rules: readonly CustomBodyRule[]): RuleHit[] {
  const out: RuleHit[] = [];
  for (const rule of rules) {
    if (!rule.on || !rule.conds.length) continue;
    const why: string[] = [];
    let ok = true;
    for (const c of rule.conds) {
      const w = check(r, c);
      if (w == null) {
        ok = false;
        break;
      }
      why.push(w);
    }
    if (ok) out.push({ key: `rule:${rule.id}`, label: rule.name, why: why.join(", ") });
  }
  return out;
}

/** Only well-formed rules get through, at most {@link MAX_RULES} of {@link MAX_CONDS} conditions each. */
export function sanitizeCustomRules(raw: unknown): CustomBodyRule[] {
  if (!Array.isArray(raw)) return [];
  const out: CustomBodyRule[] = [];
  const ids = new Set<string>();
  for (const x of raw.slice(0, MAX_RULES)) {
    if (!x || typeof x !== "object") continue;
    const o = x as Record<string, unknown>;
    const id = typeof o.id === "string" ? o.id.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 24) : "";
    if (!id || ids.has(id)) continue;
    const name = typeof o.name === "string" ? o.name.trim().slice(0, MAX_NAME) : "";
    const conds: RuleCondition[] = [];
    for (const c of Array.isArray(o.conds) ? o.conds.slice(0, MAX_CONDS) : []) {
      if (!c || typeof c !== "object") continue;
      const cc = c as Record<string, unknown>;
      const def = FIELD.get(cc.field as RuleField);
      if (!def || !RULE_OPS[def.kind].some((op) => op.key === cc.op)) continue;
      const op = cc.op as RuleOp;
      if (def.kind === "number") {
        if (typeof cc.value !== "number" || !Number.isFinite(cc.value)) continue;
        conds.push({ field: def.key, op, value: cc.value });
      } else if (def.kind === "text") {
        const v = typeof cc.value === "string" ? cc.value.trim().slice(0, MAX_TEXT) : "";
        if (!v) continue;
        conds.push({ field: def.key, op, value: v });
      } else conds.push({ field: def.key, op });
    }
    ids.add(id);
    out.push({ id, name: name || "My rule", on: o.on !== false, conds });
  }
  return out;
}
