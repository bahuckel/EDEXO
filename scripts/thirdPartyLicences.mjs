/**
 * THIRD-PARTY-LICENSES.txt for the shipped builds (review 2026-11-10 E4, plan 2.7): NOTICE.md says the bundled
 * libraries' notices travel with the app, and no build carried them (the bundlers drop the licence comments). The
 * libraries NOTICE.md names as bundled, with their production dependencies, each with its licence file's text.
 *   node scripts/thirdPartyLicences.mjs [out]   (default build/THIRD-PARTY-LICENSES.txt; bundle.mjs runs it)
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const NM = path.join(ROOT, "node_modules");

/** What NOTICE.md lists as bundled ("Runtime dependencies"). A scope ends in "/*". */
export const BUNDLED_ROOTS = [
  "express",
  "ws",
  "sql.js",
  "react",
  "react-dom",
  "scheduler",
  "three",
  "@radix-ui/*",
  "@floating-ui/*",
  "lucide-react",
  "html-to-image",
  "tailwindcss",
  "@ghostery/*",
];

const LICENCE_FILE = /^(licen[cs]e|copying)(\.(md|txt|markdown))?$/i;

function expandRoots() {
  const out = [];
  for (const r of BUNDLED_ROOTS) {
    if (!r.endsWith("/*")) {
      out.push(r);
      continue;
    }
    const scope = r.slice(0, -2);
    if (existsSync(path.join(NM, scope))) for (const n of readdirSync(path.join(NM, scope))) out.push(`${scope}/${n}`);
  }
  return out;
}

/** Every package reachable from the roots by `dependencies`, read from the top-level node_modules. */
export function bundledPackages() {
  const seen = new Map();
  const queue = expandRoots();
  while (queue.length) {
    const name = queue.shift();
    if (seen.has(name)) continue;
    const dir = path.join(NM, ...name.split("/"));
    const pj = path.join(dir, "package.json");
    if (!existsSync(pj)) continue;
    const j = JSON.parse(readFileSync(pj, "utf8"));
    seen.set(name, { name, version: j.version ?? "", licence: typeof j.license === "string" ? j.license : "", dir });
    for (const dep of Object.keys(j.dependencies ?? {})) queue.push(dep);
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function thirdPartyLicencesText() {
  const parts = [
    "Third-party software bundled into EDEXO, with its licence (see NOTICE.md).",
    "Generated from node_modules by scripts/thirdPartyLicences.mjs.",
    "",
  ];
  for (const p of bundledPackages()) {
    const file = readdirSync(p.dir).find((n) => LICENCE_FILE.test(n));
    const text = file ? readFileSync(path.join(p.dir, file), "utf8").trim() : `(${p.licence || "licence file not found"})`;
    parts.push("=".repeat(78), `${p.name} ${p.version}${p.licence ? ` — ${p.licence}` : ""}`, "=".repeat(78), text, "");
  }
  return parts.join("\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = process.argv[2] ?? path.join(ROOT, "build", "THIRD-PARTY-LICENSES.txt");
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, thirdPartyLicencesText(), "utf8");
  console.info(`[licences] ${bundledPackages().length} packages → ${out}`);
}
