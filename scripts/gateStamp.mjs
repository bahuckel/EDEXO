/**
 * The gate's stamp (plan 2.4): which state of the tree last passed `npm run gate`. A build or a release checks it, so
 * nothing ships from a tree the checks did not see. The state is HEAD plus a hash of every uncommitted change
 * (tracked diff and untracked files, docs/ left out: it is local and never shipped).
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STAMP = path.join(ROOT, "node_modules", ".cache", "edexo-gate.json");

const git = (...args) => execFileSync("git", args, { cwd: ROOT, encoding: "buffer", maxBuffer: 1 << 30 });

/** HEAD and a hash of the uncommitted changes outside docs/. */
export function treeState() {
  const head = git("rev-parse", "HEAD").toString("utf8").trim();
  const h = createHash("sha256");
  const diff = git("diff", "HEAD", "--binary", "--", ".", ":(exclude)docs");
  h.update(diff);
  const untracked = git("ls-files", "--others", "--exclude-standard", "--", ".", ":(exclude)docs")
    .toString("utf8")
    .split("\n")
    .filter(Boolean)
    .sort();
  for (const f of untracked) {
    h.update(`\0${f}\0`);
    h.update(readFileSync(path.join(ROOT, f)));
  }
  return { head, changes: h.digest("hex"), dirty: diff.length > 0 || untracked.length > 0 };
}

export function writeStamp(state) {
  mkdirSync(path.dirname(STAMP), { recursive: true });
  writeFileSync(STAMP, JSON.stringify({ ...state, at: new Date().toISOString() }, null, 2), "utf8");
}

/** Null when the tree is the one the gate last passed, else why not. */
export function stampProblem() {
  if (!existsSync(STAMP)) return "the gate has not passed on this tree yet";
  let s;
  try {
    s = JSON.parse(readFileSync(STAMP, "utf8"));
  } catch {
    return "the gate's stamp is unreadable";
  }
  const now = treeState();
  if (s.head !== now.head) return `the gate passed at ${String(s.head).slice(0, 8)}, HEAD is ${now.head.slice(0, 8)}`;
  if (s.changes !== now.changes) return "the tree changed since the gate passed";
  return null;
}
