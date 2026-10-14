/**
 * Planetary nebulae for Electricae radialem's gate (2026-10-14). The catalogue's `nebulae` are EDAstro's
 * real + procgen ones only: planetary nebulae were left out on Bark Mounds' evidence. Radialem is
 * another matter: on the EDDN year, outside the old gate, it grows on 100 % of the bodies it can grow
 * on up to 90 ly from a planetary nebula and on none past 110 ly (docs/perf/radialem-pn.py). Reads
 * EDAstro's nebulae-coordinates.csv, keeps the rows of Type "planetary", and writes them into
 * `data/exomastery/spatial-catalogue.json` as `planetary`, leaving `nebulae` as it is.
 *
 *   npx tsx scripts/add-planetary-nebulae.ts <nebulae-coordinates.csv>
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { SpatialCatalogue, SpatialPoint } from "../src/shared/spatialGates.js";

const CSV = process.argv[2];
if (!CSV) {
  console.error("usage: npx tsx scripts/add-planetary-nebulae.ts <nebulae-coordinates.csv>");
  process.exit(1);
}

/** One CSV line, honouring quoted fields. */
function splitCsv(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    else if (ch === "," && !quoted) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

const [head, ...lines] = readFileSync(CSV, "utf8")
  .split(/\r?\n/)
  .filter((l) => l.trim());
const cols = splitCsv(head!);
const at = (name: string) => {
  const i = cols.indexOf(name);
  if (i < 0) throw new Error(`no ${name} column in ${CSV}`);
  return i;
};
const [iName, iX, iY, iZ, iType] = ["Name", "X", "Y", "Z", "Type"].map(at) as [
  number,
  number,
  number,
  number,
  number,
];
const round = (v: number) => Math.round(v * 10) / 10;
const points: SpatialPoint[] = [];
for (const line of lines) {
  const f = splitCsv(line);
  if (f[iType] !== "planetary") continue;
  const [x, y, z] = [Number(f[iX]), Number(f[iY]), Number(f[iZ])];
  if (![x, y, z].every(Number.isFinite)) continue;
  points.push({ n: f[iName] ?? "", x: round(x), y: round(y), z: round(z) });
}
points.sort((a, b) => a.x - b.x || a.z - b.z);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const file = path.join(root, "data", "exomastery", "spatial-catalogue.json");
const cat = JSON.parse(readFileSync(file, "utf8")) as SpatialCatalogue;
cat.planetary = points;
cat.sources = {
  ...cat.sources,
  planetary: `edastro nebulae-coordinates.csv, Type planetary: ${points.length} (for Electricae radialem; not in nebulae)`,
};
writeFileSync(file, JSON.stringify(cat) + "\n", "utf8");
console.log(`planetary: ${points.length} planetary nebulae in ${file}`);
