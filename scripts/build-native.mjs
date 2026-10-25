#!/usr/bin/env node
/**
 * Builds native/ (1.3.1, owner 2026-10-25: "use Rust") and copies the two Windows helpers to build/native/:
 * edexo-fgwatch.exe (the HUD's foreground watcher, shipped in resources/edexo/ by electron-builder.cjs) and
 * EDExoCompare-Client-CLI.exe (the console client, which starts the Server-CLI beside it; scripts/dist-win-cli.mjs).
 * Needs Rust (cargo) on the building PC; a release must not ship without them, so a failed build stops here.
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";

if (process.platform !== "win32") {
  console.info("[native] Windows helpers only; nothing to build here.");
  process.exit(0);
}
const r = spawnSync("cargo", ["build", "--release", "--manifest-path", join("native", "Cargo.toml")], { stdio: "inherit" });
if (r.error || r.status !== 0) {
  console.error("[native] cargo build failed" + (r.error ? `: ${r.error.message} (is Rust installed? https://rustup.rs)` : ""));
  process.exit(r.status || 1);
}
mkdirSync(join("build", "native"), { recursive: true });
for (const f of ["edexo-fgwatch.exe", "EDExoCompare-Client-CLI.exe"]) {
  const to = join("build", "native", f);
  copyFileSync(join("native", "target", "release", f), to);
  console.info(`[native] ${to} (${(statSync(to).size / 1024).toFixed(0)} KB)`);
}
