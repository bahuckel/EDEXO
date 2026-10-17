/**
 * Odds measured on a year of EDDN finds and the Spansh dump's DSS lists, laid over the ranking model where
 * the model is measurably wrong (owner, 2026-10-10: "build both leads, then re-measure"; the evidence is in
 * docs/perf/deep-dive/REPORT-20261010.md).
 *
 * The model scores a body field by field against each species' profile. Two cases it cannot see:
 *
 *  - **Recepta on carbon dioxide or oxygen** grows only where sulphur dioxide is mixed in (the 1 % rule in
 *    matchSpecies), and past that line how often it is there depends on how much: 24 % at 1.0-1.1 % SO₂,
 *    86-100 % from 1.75 %. The model treats every body past the line alike.
 *  - **Bacterium tela** grows on hot bodies or on volcanic ones (its rule), and its profile is mostly hot
 *    and calm, so the model fines its cold volcanic bodies: 3.7 % on one-signal cold volcanic neon bodies
 *    where it is a third of the Bacterium.
 *
 * Both are applied after the model has shared out the body's probability, and both keep what the model
 * got right: Recepta's split among its three species, and Bacterium's total, of which tela's and
 * omentum's measured shares are all that changes (omentum since 2026-10-10, the same evidence for it;
 * verrata and scopulum with them on cold volcanic bodies since 2026-10-11, COLD_VOLCANIC_SHARE).
 */
import type { PlanetScan, SpeciesMatch } from "../shared/types.js";
import { gasSharePercent } from "../shared/atmosphereGasShare.js";
import { atmosphereTypeKeyOf } from "../shared/scanAtmosphereMatch.js";
import { reportsVolcanism, volcanismFamily } from "../shared/volcanismText.js";

/**
 * Recepta on a thin carbon dioxide (or oxygen) body: how often it is there by the sulphur dioxide share,
 * over the 1,541 such bodies past the 1 % line with a DSS and a journal scan (1,112 with Recepta). Upper
 * bound of each band, its rate in %. Over 3 % all 24 bodies had it; held at 95 rather than certain.
 */
export const RECEPTA_BY_SO2: readonly (readonly [number, number])[] = [
  [1.1, 24],
  [1.2, 52],
  [1.35, 62],
  [1.5, 75],
  [1.75, 79],
  [2.0, 86],
  [3.0, 89],
  [Infinity, 95],
];

/**
 * Bacterium tela's share of the Bacterium on bodies that meet its rule, by atmosphere and branch ("hot":
 * 300 K or more; "cold": below, with volcanism; "cold-nmagma": below, with nitrogen or ammonia magma,
 * where omentum takes its own share too), from the EDDN bodies where a Bacterium was logged (50,144 hot
 * or volcanic). Atmospheres with too few bodies are left to the model.
 */
export const TELA_SHARE: Readonly<Record<string, number>> = {
  "sulphurdioxide|hot": 53,
  "sulphurdioxide|cold": 70,
  "carbondioxide|hot": 55,
  "water|hot": 48,
  "neonrich|cold": 47,
  "neonrich|cold-nmagma": 48,
  "methane|cold": 37,
  "methane|cold-nmagma": 29,
  "neon|cold": 32,
  "neon|cold-nmagma": 30,
  "argon|cold": 30,
  "argon|cold-nmagma": 30,
  "helium|cold": 28,
};

/**
 * Bacterium omentum's share of the Bacterium on bodies with nitrogen or ammonia magma (its rule), by
 * atmosphere: 8,340 EDDN bodies (2026-10-10, owner: "build it, then re-measure"). Nearly a third
 * everywhere, half on neon-rich, where acies (neon at least 50 %) cannot grow.
 */
export const OMENTUM_SHARE: Readonly<Record<string, number>> = {
  neon: 33,
  neonrich: 52,
  argon: 31,
  methane: 30,
};

/**
 * The cold volcanic Bacterium (1.2.15, owner: "do verrata and proceed with other bacterium"): on a body
 * below 300 K with water, nitrogen, ammonia, carbon dioxide or methane volcanism the Bacterium splits
 * about three ways — tela (any volcanism) near 30 %, the volcanism's own species near a third (verrata
 * water, omentum nitrogen / ammonia, scopulum carbon dioxide / methane), and the atmosphere's own species
 * the rest. The model scored them field by field and put verrata first on 18 of 36 and scopulum on 2 of
 * 29 of their September bodies. Share of the Bacterium-logged bodies, by atmosphere | volcanism family,
 * cells of 30+ (docs/perf/bacterium-volcanic-shares.py, EDDN year); the other rows share the rest as the
 * model has them. Where a cell is missing, TELA_SHARE and OMENTUM_SHARE below still apply.
 */
export const COLD_VOLCANIC_SHARE: Readonly<Record<string, Readonly<Record<string, number>>>> = {
  "ammonia|water": { tela: 35, verrata: 61 },
  "argon|carbon dioxide": { tela: 21, scopulum: 28 },
  "argon|nitrogen": { tela: 24, omentum: 28 },
  "argon|water": { tela: 32, verrata: 34 },
  "helium|ammonia": { tela: 31, omentum: 29 },
  "helium|methane": { tela: 23, scopulum: 37 },
  "helium|water": { tela: 29, verrata: 28 },
  "methane|methane": { tela: 28, scopulum: 31 },
  "methane|nitrogen": { tela: 29, omentum: 31 },
  "neon|ammonia": { tela: 31, omentum: 32 },
  "neon|carbon dioxide": { tela: 28, scopulum: 38 },
  "neon|methane": { tela: 31, scopulum: 33 },
  "neon|nitrogen": { tela: 29, omentum: 33 },
  "neon|water": { tela: 33, verrata: 37 },
  "neonrich|ammonia": { tela: 49, omentum: 51 },
  "neonrich|carbon dioxide": { tela: 41, scopulum: 59 },
  "neonrich|methane": { tela: 46, scopulum: 54 },
  "neonrich|nitrogen": { tela: 48, omentum: 52 },
  "neonrich|water": { tela: 48, verrata: 52 },
  "oxygen|water": { tela: 33, verrata: 38 },
  "sulphurdioxide|water": { tela: 93 },
};

/** The cold volcanic cell a body falls in, or null. */
function coldVolcanicCell(scan: PlanetScan, atmo: string): Readonly<Record<string, number>> | null {
  const t = Number(scan.SurfaceTemperature);
  if (!Number.isFinite(t) || t >= 300) return null;
  return COLD_VOLCANIC_SHARE[`${atmo}|${volcanismFamily(scan.Volcanism)}`] ?? null;
}

function receptaRate(so2: number): number | null {
  if (!(so2 > 1)) return null;
  for (const [upTo, rate] of RECEPTA_BY_SO2) if (so2 <= upTo) return rate;
  return null;
}

function hasVolcanism(scan: PlanetScan): boolean {
  return reportsVolcanism(scan.Volcanism);
}

/**
 * Lays the measured odds over the model's `presenceProbabilityPercent` / `genusSharePercent` on the shown rows.
 * `afterDss`: the body's genera are named. Recepta's rate answers "is Recepta here at all", so it stands down once a
 * DSS has said (1.2.19 review: a named Recepta read 24 % × its share instead of adding up to the genus).
 */
export function applyMeasuredOdds(shown: SpeciesMatch[], scan: PlanetScan, afterDss = false): void {
  const atmo = atmosphereTypeKeyOf(scan);

  // Recepta where sulphur dioxide is a trace in another gas: the genus at its measured rate, the species
  // split as the model has it.
  if (!afterDss && (atmo === "carbondioxide" || atmo === "oxygen")) {
    const rate = receptaRate(gasSharePercent(scan, "SulphurDioxide") ?? 0);
    const rows = shown.filter((m) => m.entry.genusDataDir === "recepta");
    if (rate != null && rows.length) {
      const shares = rows.map((m) => m.genusSharePercent ?? 100 / rows.length);
      const sum = shares.reduce((a, s) => a + s, 0) || 1;
      rows.forEach((m, i) => {
        m.presenceProbabilityPercent = Math.round((rate * shares[i]!) / sum * 10) / 10;
      });
    }
  }

  // Measured shares of the Bacterium (tela, omentum); the other Bacterium rows keep their order and the rest.
  const t = Number(scan.SurfaceTemperature);
  const volc = String(scan.Volcanism ?? "").toLowerCase();
  const nmagma = /nitrogen magma|ammonia magma/.test(volc);
  const branch = Number.isFinite(t) && t >= 300 ? "hot" : hasVolcanism(scan) ? (nmagma ? "cold-nmagma" : "cold") : null;
  const fixed = new Map<string, number>();
  const cell = coldVolcanicCell(scan, atmo);
  if (cell) {
    for (const [sp, share] of Object.entries(cell)) fixed.set(`bacterium_bacterium_${sp}`, share);
  } else {
    const telaShare = branch ? (TELA_SHARE[`${atmo}|${branch}`] ?? (branch === "cold-nmagma" ? TELA_SHARE[`${atmo}|cold`] : undefined)) : undefined;
    if (telaShare !== undefined) fixed.set("bacterium_bacterium_tela", telaShare);
    if (nmagma && OMENTUM_SHARE[atmo] !== undefined) fixed.set("bacterium_bacterium_omentum", OMENTUM_SHARE[atmo]!);
  }
  const bac = shown.filter((m) => m.entry.genusDataDir === "bacterium");
  const set = bac.filter((m) => fixed.has(m.entry.id));
  const others = bac.filter((m) => !fixed.has(m.entry.id));
  if (!set.length || bac.length < 2) return;
  const round = (x: number) => Math.round(x * 10) / 10;
  // Shares of the rows present; with no other Bacterium row, the set ones split the whole between them.
  let fixedSum = set.reduce((a, m) => a + fixed.get(m.entry.id)!, 0);
  const scale = others.length === 0 || fixedSum > 100 ? 100 / fixedSum : 1;
  fixedSum *= scale;
  const total = bac.reduce((a, m) => a + (m.presenceProbabilityPercent ?? 0), 0);
  const othersTotal = others.reduce((a, m) => a + (m.presenceProbabilityPercent ?? 0), 0);
  const othersShare = others.reduce((a, m) => a + (m.genusSharePercent ?? 0), 0);
  for (const m of set) {
    const sh = fixed.get(m.entry.id)! * scale;
    if (total > 0) m.presenceProbabilityPercent = round((total * sh) / 100);
    m.genusSharePercent = round(sh);
  }
  for (const m of others) {
    if (total > 0) {
      const w = othersTotal > 0 ? (m.presenceProbabilityPercent ?? 0) / othersTotal : 1 / others.length;
      m.presenceProbabilityPercent = round(total * (1 - fixedSum / 100) * w);
    }
    const w = othersShare > 0 ? (m.genusSharePercent ?? 0) / othersShare : 1 / others.length;
    m.genusSharePercent = round((100 - fixedSum) * w);
  }
}

/**
 * What the measured odds say about one row, in words, for the candidate row's "why this chance"
 * (plan 1.7, 2026-10-11): null where no measured table applies to it.
 */
export function measuredOddsNote(m: SpeciesMatch, scan: PlanetScan): string | null {
  const atmo = atmosphereTypeKeyOf(scan);
  if (m.entry.genusDataDir === "recepta" && (atmo === "carbondioxide" || atmo === "oxygen")) {
    const so2 = gasSharePercent(scan, "SulphurDioxide") ?? 0;
    const rate = receptaRate(so2);
    if (rate != null) return `Recepta grows on ${rate} % of such bodies with ${so2.toFixed(2)} % sulphur dioxide (a year of EDDN finds)`;
  }
  const cell = coldVolcanicCell(scan, atmo);
  if (cell && m.entry.genusDataDir === "bacterium") {
    const sp = m.entry.id.replace(/^bacterium_bacterium_/, "");
    const share = cell[sp];
    return share !== undefined
      ? `${sp} is ${share} % of the Bacterium on cold bodies with ${volcanismFamily(scan.Volcanism)} volcanism and this atmosphere (a year of EDDN finds)`
      : null;
  }
  const t = Number(scan.SurfaceTemperature);
  const volc = String(scan.Volcanism ?? "").toLowerCase();
  const nmagma = /nitrogen magma|ammonia magma/.test(volc);
  const branch = Number.isFinite(t) && t >= 300 ? "hot" : hasVolcanism(scan) ? (nmagma ? "cold-nmagma" : "cold") : null;
  if (m.entry.id === "bacterium_bacterium_tela" && branch) {
    const share = TELA_SHARE[`${atmo}|${branch}`] ?? (branch === "cold-nmagma" ? TELA_SHARE[`${atmo}|cold`] : undefined);
    if (share !== undefined) return `tela is ${share} % of the Bacterium on ${branch === "hot" ? "hot" : "cold volcanic"} bodies of this atmosphere (a year of EDDN finds)`;
  }
  if (m.entry.id === "bacterium_bacterium_omentum" && nmagma && OMENTUM_SHARE[atmo] !== undefined) {
    return `omentum is ${OMENTUM_SHARE[atmo]} % of the Bacterium on nitrogen or ammonia magma bodies of this atmosphere (a year of EDDN finds)`;
  }
  return null;
}
