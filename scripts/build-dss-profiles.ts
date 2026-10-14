/**
 * Profiles for the single-species genera from the bodies a DSS confirmed (plan 1.2.17 §1.3).
 *
 * A genus with one species is named by the DSS itself, so a body whose DSS lists the genus is a
 * confirmed find of the species. The feeder corpus never held Amphora at all; Spansh's dump has 719.
 * `docs/perf/single_species_dss_contexts.py` reads them from the local export into planet contexts,
 * and this feeds those to the feeder's own builder and installer, so the profile is the same shape and
 * goes through the same downgrade guard as any other.
 *
 *   npx tsx scripts/build-dss-profiles.ts <contexts dir> amphora [bark-mound ...]          report only
 *   npx tsx scripts/build-dss-profiles.ts <contexts dir> amphora --write [--allow-downgrade]
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadSpeciesDatabaseFromTree } from "../src/server/speciesTreeLoader.js";
import { buildProfileFromPlanetContexts, type PlanetSampleContext } from "../src/feeder/profileBuilder.js";
import { sanitizeExomasteryProfileForEdexo } from "../src/feeder/profileExportSanitize.js";
import { describeInstall, installProfile } from "../src/feeder/install.js";
import type { FeederStarSummary } from "../src/feeder/feederStarHost.js";
import type { EdsmBody } from "../src/feeder/edsm.js";
import { buildDisplayHistograms, buildSpeciesHistograms } from "../src/feeder/histograms.js";
import { flattenForStats } from "../src/feeder/flatten.js";
import type { HistogramEdgesFile } from "../src/shared/likelihoodBins.js";
import { shouldOmitExomasterySciencePath } from "../src/server/exomasteryPathHygiene.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const [dir, ...genera] = args.filter((a) => !a.startsWith("--"));
if (!dir || genera.length === 0) {
  console.error(
    "usage: npx tsx scripts/build-dss-profiles.ts <contexts dir> <genus dir...> [--write] [--allow-downgrade]",
  );
  process.exit(1);
}

interface ContextRow {
  systemName: string;
  bodyName: string;
  targetBody: EdsmBody;
  starSummaries: (FeederStarSummary & { isMainStar?: boolean })[];
  systemPrimaryStar: FeederStarSummary | null;
}

const star = (s: FeederStarSummary): FeederStarSummary => ({
  name: s.name,
  ...(s.subType ? { subType: s.subType } : {}),
  ...(s.spectralClass ? { spectralClass: s.spectralClass } : {}),
  ...(typeof s.bodyId === "number" ? { bodyId: s.bodyId } : {}),
});

const db = loadSpeciesDatabaseFromTree(root);
const edgesFile = JSON.parse(
  readFileSync(path.join(root, "data", "exomastery", "histogram-edges.json"), "utf8"),
) as HistogramEdgesFile;
for (const genusDir of genera) {
  const entries = db.species.filter((e) => e.genusDataDir === genusDir);
  if (entries.length !== 1) {
    console.error(`${genusDir}: ${entries.length} species — this is for single-species genera only`);
    process.exitCode = 1;
    continue;
  }
  const entry = entries[0]!;
  const rows = readFileSync(path.join(dir, `${genusDir}.contexts.jsonl`), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as ContextRow);
  const contexts: PlanetSampleContext[] = rows.map((r) => ({
    targetBody: r.targetBody,
    systemName: r.systemName,
    bodyName: r.bodyName,
    starSummaries: r.starSummaries.map(star),
    ...(r.systemPrimaryStar ? { systemPrimaryStar: star(r.systemPrimaryStar) } : {}),
  }));
  const built = buildProfileFromPlanetContexts(entry.displayName, entry.genus, contexts, {
    csvRows: rows.length,
    occurrences: rows.length,
  });
  const profile = sanitizeExomasteryProfileForEdexo(built);
  /*
    The ranking model's histograms, on the corpus's shared edges, as applyParameterImportance writes them for the
    feeder's profiles (it reads the feeder's sample packs, which hold none of these bodies). Without them a profile
    is scored on its categorical terms alone and pays none of the ~27 numeric ones every other species pays, so it
    wins the body's softmax: the 8,036-body Bark Mounds profile took Brain Tree and Tubers shares down ten-fold on
    2-signal bodies (2026-10-14).
  */
  const samples = new Map<string, number[]>();
  for (const r of rows) {
    for (const [p, v] of flattenForStats(r.targetBody, "body", 0, new Map())) {
      if (typeof v !== "number" || !Number.isFinite(v) || shouldOmitExomasterySciencePath(p)) continue;
      const list = samples.get(p) ?? [];
      list.push(v);
      samples.set(p, list);
    }
  }
  const histograms = buildSpeciesHistograms(samples, edgesFile.edges);
  const displayHistograms = buildDisplayHistograms(samples);
  const withHist: typeof profile & { histograms?: unknown; displayHistograms?: unknown } = profile;
  if (Object.keys(histograms).length > 0) withHist.histograms = histograms;
  if (Object.keys(displayHistograms).length > 0) withHist.displayHistograms = displayHistograms;

  const cat = profile.categorical as Record<string, Record<string, number>>;
  const num = profile.numerics as Record<string, { min: number; max: number; mode: number; count: number }>;
  const top = (k: string) =>
    Object.entries(cat[k] ?? {})
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([v, n]) => `${v} ${n}`)
      .join(", ");
  console.log(`\n${entry.displayName} (${genusDir}): ${rows.length} DSS-confirmed bodies`);
  for (const k of [
    "body.surfaceTemperature",
    "body.gravity",
    "body.surfacePressure",
    "body.distanceToArrival",
  ]) {
    const n = num[k];
    if (n) console.log(`  ${k.padEnd(28)} ${n.min} .. ${n.max}, mode ${n.mode} (${n.count})`);
  }
  for (const k of [
    "body.subType",
    "body.atmosphereType",
    "body.volcanismType",
    "exo.host_star_spectral_primary",
    "exo.system_primary_spectral",
  ]) {
    console.log(`  ${k.padEnd(28)} ${top(k)}`);
  }
  if (flags.has("--write")) {
    console.log(
      `  ${describeInstall(installProfile(db, profile, { allowDowngrade: flags.has("--allow-downgrade") }))}`,
    );
  }
}
