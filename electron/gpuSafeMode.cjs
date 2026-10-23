/**
 * Safe graphics mode: hardware acceleration off (L1, Linux ticket T-MVFLSBPM-E5DC, 2026-10-23).
 *
 * The report: CachyOS, KDE Plasma on Wayland, hybrid NVIDIA, the AppImage. The GPU process dies at start (exit 139),
 * then XWayland window errors, and the app is gone; it starts with `--disable-gpu --disable-gpu-sandbox
 * --ozone-platform=x11`. The third is ours already (main.cjs, for the HUD windows); this file is the other two.
 *
 * - On Linux a GPU process that dies in the first half minute turns the mode on, remembered in
 *   `gpu-safe-mode.json` (Electron's own directory), and the app starts again once with it.
 * - The launcher has the switch ("Hardware acceleration"), on every platform: off by hand, or on again to try the GPU
 *   once more after a driver update.
 * - `EDEXO_SAFE_GRAPHICS=1`, or `--disable-gpu` on the command line, for a start that dies before anything here runs.
 *
 * Not app-wide by default: without the GPU the galaxy map draws in software or not at all (Classic map instead).
 */
const fs = require("fs");
const path = require("path");

const GPU_SAFE_FILE = "gpu-safe-mode.json";
/** Given to the one start after an automatic switch, so a second crash cannot loop. */
const GPU_RETRY_ARG = "--edexo-gpu-retry";
/** A GPU crash later than this is not a start-up crash: Chromium restarts its GPU process on its own. */
const STARTUP_WINDOW_MS = 30_000;
/** Reasons Electron gives for a GPU process that did not go normally (`child-process-gone`). */
const BAD_EXITS = new Set(["crashed", "abnormal-exit", "launch-failed", "integrity-failure", "oom"]);

/** @returns {{ on: boolean, auto: boolean, reason: string, at: string } | null} */
function readGpuSafe(dir) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(dir, GPU_SAFE_FILE), "utf8"));
    if (!j || typeof j !== "object" || j.on !== true) return null;
    return {
      on: true,
      auto: j.auto === true,
      reason: typeof j.reason === "string" ? j.reason : "",
      at: typeof j.at === "string" ? j.at : "",
    };
  } catch {
    return null;
  }
}

function writeGpuSafe(dir, rec) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, GPU_SAFE_FILE), JSON.stringify({ on: true, ...rec }, null, 2), "utf8");
    return true;
  } catch {
    return false;
  }
}

function clearGpuSafe(dir) {
  try {
    fs.rmSync(path.join(dir, GPU_SAFE_FILE), { force: true });
  } catch {
    /* nothing to clear */
  }
}

/**
 * Whether this start runs without the GPU, and why: "argv" (the commander's own `--disable-gpu`), "env"
 * (`EDEXO_SAFE_GRAPHICS=1`), "flag" (the remembered mode), or null.
 *
 * @param {{ env: Record<string, string | undefined>, argv: string[], flag: object | null }} o
 */
function graphicsMode(o) {
  if (o.argv.some((a) => a === "--disable-gpu")) return { safe: true, why: "argv", addSwitches: false };
  if (o.env.EDEXO_SAFE_GRAPHICS === "1") return { safe: true, why: "env", addSwitches: true };
  if (o.flag && o.flag.on) return { safe: true, why: "flag", addSwitches: true };
  return { safe: false, why: null, addSwitches: false };
}

/**
 * A GPU process gone badly early in a Linux start, with the GPU still in use and no retry yet: switch to safe mode.
 *
 * @param {{ platform: string, details: { type?: string, reason?: string } | null, sinceStartMs: number,
 *   safe: boolean, argv: string[] }} o
 */
function shouldSwitchToSafe(o) {
  if (o.platform !== "linux" || o.safe) return false;
  if (o.argv.includes(GPU_RETRY_ARG)) return false;
  const d = o.details;
  if (!d || d.type !== "GPU" || !BAD_EXITS.has(String(d.reason))) return false;
  return o.sinceStartMs <= STARTUP_WINDOW_MS;
}

module.exports = {
  GPU_SAFE_FILE,
  GPU_RETRY_ARG,
  STARTUP_WINDOW_MS,
  readGpuSafe,
  writeGpuSafe,
  clearGpuSafe,
  graphicsMode,
  shouldSwitchToSafe,
};
