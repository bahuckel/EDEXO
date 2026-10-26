/**
 * One full garbage collection right after a big job lets go of its leftovers (owner, 2026-10-26: memory).
 *
 * A start that loads the journal merge cache leaves the decoded payload behind: measured on the server alone, the
 * process sat at about 255 MB for two minutes after a cached start, until V8's idle memory reducer collected it,
 * and then at about 130 MB. The server is quiet after its boot, so nothing else makes V8 collect sooner. A smaller
 * young generation (`--max-semi-space-size`) got there sooner too but ended at the same 130 MB; one collection at
 * the end of the job gives about 125 MB some 20 s after the boot, without changing how the server runs.
 *
 * `gc` is switched on at run time (`--expose-gc` through v8.setFlagsFromString, then taken from a fresh context):
 * Electron's utility process ignores V8 flags in `execArgv`, and this way the console server has it too. Where it
 * cannot be had, this does nothing and the reducer collects as before.
 */
import v8 from "node:v8";
import vm from "node:vm";

const DELAY_MS = 3000;

let timer: ReturnType<typeof setTimeout> | null = null;
let exposed: (() => void) | null | undefined;

function exposedGc(): (() => void) | null {
  if (exposed !== undefined) return exposed;
  const own = (globalThis as { gc?: () => void }).gc;
  if (typeof own === "function") return (exposed = own);
  try {
    v8.setFlagsFromString("--expose-gc");
    const gc: unknown = vm.runInNewContext("gc");
    exposed = typeof gc === "function" ? (gc as () => void) : null;
  } catch {
    exposed = null;
  }
  return exposed;
}

/** A full collection a few seconds from now (after the job's last writes and pushes); calls in between share one. */
export function collectGarbageSoon(gc: (() => void) | null = exposedGc()): void {
  if (typeof gc !== "function" || timer) return;
  timer = setTimeout(() => {
    timer = null;
    gc();
  }, DELAY_MS);
  // Never the reason a process stays alive.
  (timer as { unref?: () => void }).unref?.();
}
