/**
 * Jumponium: the raw materials of the FSD injection synthesis (owner, 2026-10-13: "material gathering for an FSD
 * booster based on body detected and announced, also trackable on galmap with filters"; "injection/jumponium, all
 * tiers of it"; in 1.2.16).
 *
 * - Recipes (Inara's synthesis page, 2026-10-13: one of each material): basic +25 % jump range (carbon, vanadium,
 *   germanium), standard +50 % (+ cadmium, niobium), premium +100 % (carbon, germanium, arsenic, niobium, yttrium,
 *   polonium). His journals hold no FSD injection `Synthesis` yet; the first one lists what it used, and
 *   {@link learnRecipe} takes its counts over.
 * - Inventory: `Materials` at every login sets the raw list; `MaterialCollected`, `MaterialDiscarded`,
 *   `MaterialTrade`, `Synthesis`, `EngineerCraft`, `TechnologyBroker`, `EngineerContribution`, `ScientificResearch`
 *   and `MissionCompleted` rewards move it until the next login. Raw caps by grade: 300 / 250 / 200 / 150.
 * - Bodies: a landable body's `Scan` lists its elements in percent. "Good" is the top tenth of landable bodies for
 *   that element, measured on Spansh's dump (Ryker's Hope region, 4,189,719 landable bodies, 2026-10-13).
 */

export type JumpElement =
  "carbon" | "vanadium" | "germanium" | "cadmium" | "niobium" | "arsenic" | "yttrium" | "polonium";
export type InjectionTier = "basic" | "standard" | "premium";

export const JUMP_ELEMENTS: readonly {
  key: JumpElement;
  label: string;
  symbol: string;
  grade: 1 | 2 | 3 | 4;
  good: number;
}[] = [
  { key: "carbon", label: "Carbon", symbol: "C", grade: 1, good: 23.1 },
  { key: "vanadium", label: "Vanadium", symbol: "V", grade: 2, good: 5.58 },
  { key: "germanium", label: "Germanium", symbol: "Ge", grade: 2, good: 5.68 },
  { key: "arsenic", label: "Arsenic", symbol: "As", grade: 2, good: 2.61 },
  { key: "cadmium", label: "Cadmium", symbol: "Cd", grade: 3, good: 1.75 },
  { key: "niobium", label: "Niobium", symbol: "Nb", grade: 3, good: 1.54 },
  { key: "yttrium", label: "Yttrium", symbol: "Y", grade: 4, good: 1.35 },
  { key: "polonium", label: "Polonium", symbol: "Po", grade: 4, good: 0.64 },
];

const BY_KEY = new Map(JUMP_ELEMENTS.map((e) => [e.key, e]));
export const jumpElement = (k: JumpElement) => BY_KEY.get(k)!;
export const isJumpElement = (s: string): s is JumpElement => BY_KEY.has(s as JumpElement);

/** Raw material caps by grade (grade 5 does not exist for raw). */
export const RAW_CAP: Record<1 | 2 | 3 | 4, number> = { 1: 300, 2: 250, 3: 200, 4: 150 };

export type Recipe = Partial<Record<JumpElement, number>>;

export const INJECTIONS: readonly {
  tier: InjectionTier;
  name: string;
  synthesis: string;
  bonusPct: number;
  recipe: Recipe;
}[] = [
  {
    tier: "basic",
    name: "Basic",
    synthesis: "FSD Basic",
    bonusPct: 25,
    recipe: { carbon: 1, vanadium: 1, germanium: 1 },
  },
  {
    tier: "standard",
    name: "Standard",
    synthesis: "FSD Standard",
    bonusPct: 50,
    recipe: { carbon: 1, vanadium: 1, germanium: 1, cadmium: 1, niobium: 1 },
  },
  {
    tier: "premium",
    name: "Premium",
    synthesis: "FSD Premium",
    bonusPct: 100,
    recipe: { carbon: 1, germanium: 1, arsenic: 1, niobium: 1, yttrium: 1, polonium: 1 },
  },
];

export interface JumponiumState {
  /** Raw counts by lower-case name, every raw element (not only jumponium); null until a `Materials` line. */
  raw: Record<string, number> | null;
  /** ISO time of the last `Materials` line. */
  loginAt: string | null;
  /** Recipes as the game used them, from the commander's own `Synthesis` lines (tier → counts). */
  learned: Partial<Record<InjectionTier, Recipe>>;
  /** FSD injections synthesised, by tier. */
  made: Partial<Record<InjectionTier, number>>;
}

export function newJumponium(): JumponiumState {
  return { raw: null, loginAt: null, learned: {}, made: {} };
}

const lc = (v: unknown) => (typeof v === "string" ? v.trim().toLowerCase() : "");
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** Raw, as the journal names it now and in older versions ("$MICRORESOURCE_CATEGORY_Elements;"). */
function isRaw(category: unknown): boolean {
  const c = lc(category);
  return c === "raw" || c.includes("elements");
}

function gradeOf(name: string): 1 | 2 | 3 | 4 | null {
  if (isJumpElement(name)) return jumpElement(name).grade;
  return RAW_GRADE[name] ?? null;
}

/** The other raw elements' grades, so their counts are capped too. */
const RAW_GRADE: Record<string, 1 | 2 | 3 | 4> = {
  iron: 1,
  lead: 1,
  nickel: 1,
  phosphorus: 1,
  rhenium: 1,
  sulphur: 1,
  chromium: 2,
  manganese: 2,
  zinc: 2,
  zirconium: 2,
  boron: 3,
  mercury: 3,
  molybdenum: 3,
  tin: 3,
  tungsten: 3,
  antimony: 4,
  ruthenium: 4,
  selenium: 4,
  technetium: 4,
  tellurium: 4,
};

function add(st: JumponiumState, name: string, delta: number): void {
  if (!st.raw || !name || !delta) return;
  // Raw elements only: crafting lists mix in manufactured and encoded materials by name.
  const g = gradeOf(name);
  if (!g) return;
  st.raw[name] = Math.max(0, Math.min(RAW_CAP[g], (st.raw[name] ?? 0) + delta));
}

/** The `{ Name, Count }` lists of Synthesis / EngineerCraft / TechnologyBroker (and the old `{ name: count }` map). */
function eachIngredient(v: unknown, fn: (name: string, count: number, category: unknown) => void): void {
  if (Array.isArray(v)) {
    for (const it of v) {
      const o = it as Record<string, unknown> | null;
      if (o) fn(lc(o.Name), num(o.Count), o.Category);
    }
  } else if (v && typeof v === "object") {
    for (const [k, c] of Object.entries(v as Record<string, unknown>)) fn(lc(k), num(c), undefined);
  }
}

const tierOfSynthesis = (name: unknown) => INJECTIONS.find((i) => lc(i.synthesis) === lc(name))?.tier ?? null;

/** The journal events {@link jumponiumLine} reads (the store skips the rest). */
export const JUMPONIUM_EVENTS: ReadonlySet<string> = new Set([
  "Materials",
  "MaterialCollected",
  "MaterialDiscarded",
  "MaterialTrade",
  "Synthesis",
  "EngineerCraft",
  "TechnologyBroker",
  "EngineerContribution",
  "ScientificResearch",
  "MissionCompleted",
]);

export function jumponiumLine(st: JumponiumState, line: Record<string, unknown>): void {
  switch (line.event) {
    case "Materials": {
      const raw: Record<string, number> = {};
      if (Array.isArray(line.Raw))
        for (const m of line.Raw as Record<string, unknown>[])
          if (lc(m?.Name)) raw[lc(m.Name)] = num(m.Count);
      st.raw = raw;
      st.loginAt = typeof line.timestamp === "string" ? line.timestamp : null;
      return;
    }
    case "MaterialCollected":
      if (isRaw(line.Category)) add(st, lc(line.Name), num(line.Count));
      return;
    case "MaterialDiscarded":
      if (isRaw(line.Category)) add(st, lc(line.Name), -num(line.Count));
      return;
    case "ScientificResearch":
      if (isRaw(line.Category)) add(st, lc(line.Name), -num(line.Count));
      return;
    case "MaterialTrade": {
      const paid = line.Paid as Record<string, unknown> | null;
      const got = line.Received as Record<string, unknown> | null;
      if (paid && isRaw(paid.Category)) add(st, lc(paid.Material), -num(paid.Quantity));
      if (got && isRaw(got.Category)) add(st, lc(got.Material), num(got.Quantity));
      return;
    }
    case "Synthesis": {
      eachIngredient(line.Materials, (n, c) => add(st, n, -c));
      const tier = tierOfSynthesis(line.Name);
      if (tier) {
        st.made[tier] = (st.made[tier] ?? 0) + 1;
        learnRecipe(st, tier, line.Materials);
      }
      return;
    }
    case "EngineerCraft":
      eachIngredient(line.Ingredients, (n, c) => add(st, n, -c));
      return;
    case "TechnologyBroker":
      eachIngredient(line.Materials, (n, c, cat) => {
        if (cat == null || isRaw(cat)) add(st, n, -c);
      });
      return;
    case "EngineerContribution":
      if (line.Type === "Materials") add(st, lc(line.Material), -num(line.Quantity));
      return;
    case "MissionCompleted":
      eachIngredient(line.MaterialsReward, (n, c, cat) => {
        if (isRaw(cat)) add(st, n, c);
      });
      return;
  }
}

/** What a `Synthesis` line used for a tier, when every material in it is jumponium. */
export function learnRecipe(st: JumponiumState, tier: InjectionTier, materials: unknown): void {
  const r: Recipe = {};
  let ok = true;
  eachIngredient(materials, (n, c) => {
    if (isJumpElement(n) && c > 0) r[n] = c;
    else ok = false;
  });
  if (ok && Object.keys(r).length) st.learned[tier] = r;
}

export function recipeFor(st: JumponiumState | null, tier: InjectionTier): Recipe {
  return st?.learned[tier] ?? INJECTIONS.find((i) => i.tier === tier)!.recipe;
}

/** How many of a tier the stock makes, and what one more would need. */
export function craftable(
  st: JumponiumState,
  tier: InjectionTier,
): { count: number; short: Partial<Record<JumpElement, number>> } {
  const rec = recipeFor(st, tier);
  let count = Number.POSITIVE_INFINITY;
  for (const [k, q] of Object.entries(rec) as [JumpElement, number][])
    count = Math.min(count, Math.floor((st.raw?.[k] ?? 0) / q));
  if (!Number.isFinite(count)) count = 0;
  const short: Partial<Record<JumpElement, number>> = {};
  for (const [k, q] of Object.entries(rec) as [JumpElement, number][]) {
    const need = (count + 1) * q - (st.raw?.[k] ?? 0);
    if (need > 0) short[k] = need;
  }
  return { count, short };
}

export function hydrateJumponium(raw: unknown): JumponiumState {
  const st = newJumponium();
  const r = raw as Partial<JumponiumState> | null;
  if (!r || typeof r !== "object") return st;
  if (r.raw && typeof r.raw === "object") {
    st.raw = {};
    for (const [k, v] of Object.entries(r.raw))
      if (typeof v === "number" && Number.isFinite(v)) st.raw[k] = v;
  }
  st.loginAt = typeof r.loginAt === "string" ? r.loginAt : null;
  for (const i of INJECTIONS) {
    const l = (r.learned as Record<string, unknown> | undefined)?.[i.tier];
    if (l && typeof l === "object") {
      const rec: Recipe = {};
      for (const [k, v] of Object.entries(l))
        if (isJumpElement(k) && typeof v === "number" && v > 0) rec[k] = v;
      if (Object.keys(rec).length) st.learned[i.tier] = rec;
    }
    const m = (r.made as Record<string, unknown> | undefined)?.[i.tier];
    if (typeof m === "number" && m > 0) st.made[i.tier] = m;
  }
  return st;
}

/* ---- bodies ---------------------------------------------------------------------------------- */

export interface JumpHit {
  key: JumpElement;
  percent: number;
  /** In the top tenth of landable bodies for this element. */
  good: boolean;
}

export interface BodyJumponium {
  hits: JumpHit[];
  /** The tiers whose every material the body has. */
  tiers: InjectionTier[];
}

/** A body's jumponium from its `Scan` materials (`Name` / `name`, `Percent` / `percent`, any case). */
export function bodyJumponium(materials: unknown): BodyJumponium | null {
  if (!Array.isArray(materials) || materials.length === 0) return null;
  const pct = new Map<JumpElement, number>();
  for (const m of materials as Record<string, unknown>[]) {
    const n = lc(m?.Name ?? m?.name);
    const p = num(m?.Percent ?? m?.percent);
    if (isJumpElement(n) && p > 0) pct.set(n, p);
  }
  if (pct.size === 0) return null;
  const hits = JUMP_ELEMENTS.filter((e) => pct.has(e.key)).map((e) => ({
    key: e.key,
    percent: pct.get(e.key)!,
    good: pct.get(e.key)! >= e.good,
  }));
  const tiers = INJECTIONS.filter((i) => Object.keys(i.recipe).every((k) => pct.has(k as JumpElement))).map(
    (i) => i.tier,
  );
  return { hits, tiers };
}

/** "Po 1.12 %", the way the app writes a hit. */
export function hitLabel(h: JumpHit): string {
  return `${jumpElement(h.key).symbol} ${h.percent >= 10 ? h.percent.toFixed(1) : h.percent.toFixed(2)} %`;
}

/* ---- what the client shows ------------------------------------------------------------------- */

export interface JumponiumDTO {
  /** False until the journals hold a `Materials` line (the game writes one at every login). */
  known: boolean;
  loginAt: string | null;
  stock: { key: JumpElement; symbol: string; label: string; count: number; cap: number }[];
  tiers: {
    tier: InjectionTier;
    name: string;
    bonusPct: number;
    /** Injections the stock makes now. */
    count: number;
    /** What one more needs: element and how many short. */
    short: { key: JumpElement; symbol: string; need: number }[];
    made: number;
  }[];
}

export function jumponiumView(st: JumponiumState): JumponiumDTO {
  return {
    known: st.raw != null,
    loginAt: st.loginAt,
    stock: JUMP_ELEMENTS.map((e) => ({
      key: e.key,
      symbol: e.symbol,
      label: e.label,
      count: st.raw?.[e.key] ?? 0,
      cap: RAW_CAP[e.grade],
    })),
    tiers: INJECTIONS.map((i) => {
      const c = craftable(st, i.tier);
      return {
        tier: i.tier,
        name: i.name,
        bonusPct: i.bonusPct,
        count: c.count,
        short: (Object.entries(c.short) as [JumpElement, number][]).map(([key, need]) => ({
          key,
          symbol: jumpElement(key).symbol,
          need,
        })),
        made: st.made[i.tier] ?? 0,
      };
    }),
  };
}

/* ---- the neutron planner's gaps ---------------------------------------------------------------- */

export interface InjectionSave {
  tier: InjectionTier;
  /** Injections of this tier, one per jump, that take one normal jump off the stretch. */
  count: number;
}

/**
 * Where an FSD injection takes a jump off a stretch of `jumps` normal jumps covering `ly` at `rangeLy` (owner,
 * 2026-10-13: "add the neutron gap injection hint"). An injection boosts one normal jump by its bonus and does not
 * stack with a neutron supercharge, so it only helps the normal jumps. One jump fewer means `jumps - 1` jumps must
 * cover the stretch: (jumps − 1)·R + k·bonus·R ≥ ly, with k at most jumps − 1. Empty when no tier can do it.
 */
export function injectionsToSaveJump(ly: number, jumps: number, rangeLy: number): InjectionSave[] {
  if (!(rangeLy > 0) || jumps < 2 || !(ly > 0)) return [];
  const excess = ly - (jumps - 1) * rangeLy;
  if (excess <= 0) return [];
  const out: InjectionSave[] = [];
  for (const i of INJECTIONS) {
    const count = Math.ceil(excess / ((i.bonusPct / 100) * rangeLy) - 1e-9);
    if (count >= 1 && count <= jumps - 1) out.push({ tier: i.tier, count });
  }
  return out;
}
