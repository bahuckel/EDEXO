/**
 * Opt-in client instrumentation for the v0.2.0 baseline.
 *
 * Enable with `?perf=1` in the URL, or `localStorage.setItem("edexo.perf", "1")` then reload.
 * Measures, per incoming snapshot: payload bytes, message → React commit, and message → next
 * paint. Prints a rolling summary to the console every PERF_REPORT_MS.
 *
 * Disabled by default; every entry point early-returns so the WebSocket path pays nothing.
 */

const PERF_REPORT_MS = 30_000;
const MAX_SAMPLES = 4000;

export const CLIENT_PERF_ENABLED: boolean = (() => {
  try {
    if (typeof window === "undefined") return false;
    if (new URLSearchParams(window.location.search).get("perf") === "1") return true;
    return window.localStorage.getItem("edexo.perf") === "1";
  } catch {
    return false;
  }
})();

const commitMs: number[] = [];
const paintMs: number[] = [];
const bytes: number[] = [];
let received = 0;
let windowStartedAt = Date.now();
let pendingAt: number | null = null;
let reporter: number | null = null;

function push(arr: number[], v: number): void {
  if (arr.length < MAX_SAMPLES) arr.push(v);
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx]!;
}

function stat(raw: number[], unit: "ms" | "b"): string {
  if (raw.length === 0) return "—";
  const s = [...raw].sort((a, b) => a - b);
  const f = (n: number) =>
    unit === "ms" ? `${n.toFixed(n < 10 ? 2 : 1)}ms` : n >= 1024 ? `${(n / 1024).toFixed(1)}KB` : `${n}B`;
  return `p50=${f(percentile(s, 50))} p95=${f(percentile(s, 95))} max=${f(s[s.length - 1]!)}`;
}

function report(): void {
  const windowMin = (Date.now() - windowStartedAt) / 60_000;
  if (received === 0) {
    console.log("[perf] client — no snapshots this window");
  } else {
    console.log(
      [
        `[perf] client — ${received} snapshots (${(received / windowMin).toFixed(1)}/min)`,
        `       payload  ${stat(bytes, "b")}`,
        `       →commit  ${stat(commitMs, "ms")}`,
        `       →paint   ${stat(paintMs, "ms")}`,
      ].join("\n"),
    );
  }
  commitMs.length = 0;
  paintMs.length = 0;
  bytes.length = 0;
  received = 0;
  windowStartedAt = Date.now();
}

function ensureReporter(): void {
  if (!CLIENT_PERF_ENABLED || reporter != null) return;
  windowStartedAt = Date.now();
  reporter = window.setInterval(report, PERF_REPORT_MS);
  console.log(`[perf] client instrumentation ON — reporting every ${PERF_REPORT_MS / 1000}s`);
}

/**
 * Call as soon as a snapshot payload arrives, before setState; `arrivedAt` when it came before parsing
 * (the WebSocket path parses to learn the message type, and its timer used to start after that). Of
 * several within a second before one commit, the first arrival is kept: what the commander waited
 * from (code review, 2026-10-14: each overwrote the last, so a burst read as fast).
 */
export function perfSnapshotReceived(payloadBytes: number, arrivedAt = performance.now()): void {
  if (!CLIENT_PERF_ENABLED) return;
  ensureReporter();
  received += 1;
  push(bytes, payloadBytes);
  // An arrival with no commit after it (nothing changed: the snapshot object is reused) must not
  // linger as the start of the next one: older than a second, it is replaced.
  if (pendingAt == null || arrivedAt - pendingAt > 1000) pendingAt = arrivedAt;
}

/**
 * Call from an effect that runs after the snapshot has been committed to the DOM. "paint" is the next
 * animation frame after that: close to when it is on screen, not a measured present.
 */
export function perfSnapshotCommitted(): void {
  if (!CLIENT_PERF_ENABLED || pendingAt == null) return;
  const started = pendingAt;
  pendingAt = null;
  push(commitMs, performance.now() - started);
  requestAnimationFrame(() => push(paintMs, performance.now() - started));
}
