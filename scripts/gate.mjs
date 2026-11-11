/**
 * `npm run gate` (plan 2.4, review 2026-11-10 §2.3): the checks a build or a release needs first, in one command,
 * in a throwaway profile. CI is off by the owner's choice, so this is the check.
 *
 *   typecheck → lint → full suite with the coverage floors → spawn suite (not in the full run)
 *
 * EDEXO_USER_DATA_DIR is set to a fresh temporary folder for every step, whatever the shell had: a test or probe
 * without it writes into the commander's live profile (2026-10-09). Workers: GATE_WORKERS (default 3; the owner's PC
 * stays usable). On success the tree's state is stamped (gateStamp.mjs) and `dist:*` checks that stamp.
 *
 * Not here: the HUD readers' `--check` benches (scripts/build-hud-*-glyphs.ts), which need the owner's F10 image sets.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ROOT, treeState, writeStamp } from "./gateStamp.mjs";

const profile = mkdtempSync(path.join(tmpdir(), "edexo-gate-profile-"));
const workers = process.env.GATE_WORKERS || "3";
const env = { ...process.env, EDEXO_USER_DATA_DIR: profile };
const before = treeState();

const steps = [
  ["typecheck", "npm", ["run", "typecheck"]],
  ["lint", "npm", ["run", "lint"]],
  // With coverage (about 20 s more): the per-folder floors in vitest.config.ts fail the gate (plan 2.5).
  ["tests", "npx", ["vitest", "run", "--coverage", `--maxWorkers=${workers}`]],
  ["spawn suite", "npx", ["vitest", "run", "tests/speciesSpawnBodies.test.ts"]],
];

let failed = null;
for (const [name, cmd, args] of steps) {
  const t0 = Date.now();
  process.stdout.write(`gate: ${name} ...\n`);
  const r = spawnSync(cmd, args, { cwd: ROOT, env, stdio: "inherit", shell: process.platform === "win32" });
  const s = ((Date.now() - t0) / 1000).toFixed(0);
  if (r.status !== 0) {
    failed = name;
    process.stdout.write(`gate: ${name} FAILED (${s} s)\n`);
    break;
  }
  process.stdout.write(`gate: ${name} ok (${s} s)\n`);
}
rmSync(profile, { recursive: true, force: true });

if (failed) process.exit(1);
// Stamped only when nothing changed while it ran: the checks saw this tree.
const after = treeState();
if (after.head !== before.head || after.changes !== before.changes) {
  process.stdout.write("gate: passed, but the tree changed while it ran; not stamped\n");
  process.exit(1);
}
writeStamp(after);
process.stdout.write(`gate: passed at ${after.head.slice(0, 8)}${after.dirty ? " with uncommitted changes" : ""}\n`);
