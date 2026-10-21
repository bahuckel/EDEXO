/**
 * One queue per upstream API, shared by every caller in the process (PERF-M5).
 *
 * Spansh had no gate at all: three depot plans in parallel, two commodity searches each, plus
 * coordinate look-ups and station-body fetches, put a dozen requests on a volunteer-run service
 * at once. Nothing read `Retry-After`, so a 429 simply became "no sellers" for that commodity.
 * EDSM had a serial gate, but no retry either.
 *
 * A gate bounds how many requests are in flight, spaces their starts, and on a throttle or a
 * gateway error pauses the WHOLE gate — every other request to that host would get the same
 * answer — then retries. A plain 500 is not retried: Spansh answers the `symbol` filter with a
 * deterministic 500, and retrying it only triples the cost of a known failure.
 *
 * The timeout starts when a request leaves the queue, not when it joins it. A signal created by
 * the caller would have been counting down while the request waited its turn.
 */

const RETRY_STATUS = new Set([429, 502, 503, 504]);

export type HttpGateOptions = {
  /** Requests allowed in flight at once. */
  concurrency: number;
  /** Minimum time between two request starts. */
  minGapMs?: number;
  /** Extra attempts after a throttle or gateway error. */
  retries?: number;
  /** First back-off when the server gives no `Retry-After`; doubles per attempt. */
  baseDelayMs?: number;
  /** Ceiling for any single pause, including one the server asks for. */
  maxDelayMs?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

export type HttpGate = {
  fetch: (url: string, init?: RequestInit, opts?: { timeoutMs?: number }) => Promise<Response>;
  /** Requests queued or in flight; for tests and diagnostics. */
  pending: () => number;
};

/** `Retry-After` is either delta-seconds or an HTTP date. */
export function retryAfterMs(header: string | null, now: number): number | null {
  const h = header?.trim();
  if (!h) return null;
  if (/^\d+(\.\d+)?$/.test(h)) return Number(h) * 1000;
  const at = Date.parse(h);
  return Number.isFinite(at) ? Math.max(0, at - now) : null;
}

const realSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export function createHttpGate(options: HttpGateOptions): HttpGate {
  const concurrency = Math.max(1, Math.floor(options.concurrency));
  const minGapMs = Math.max(0, options.minGapMs ?? 0);
  const retries = Math.max(0, options.retries ?? 0);
  const baseDelayMs = options.baseDelayMs ?? 1000;
  const maxDelayMs = options.maxDelayMs ?? 30_000;
  const sleep = options.sleep ?? realSleep;
  const now = options.now ?? Date.now;
  const doFetch = (url: string, init?: RequestInit) => (options.fetchImpl ?? fetch)(url, init);

  let active = 0;
  let queued = 0;
  const waiters: Array<() => void> = [];
  /** Earliest start for the next request under `minGapMs`. */
  let nextStartAt = 0;
  /** Set by a throttle: nothing starts before this. */
  let pausedUntil = 0;

  async function acquire(): Promise<void> {
    queued++;
    if (active < concurrency) active++;
    else await new Promise<void>((resolve) => waiters.push(resolve));
    queued--;
    /** Reserve a start time before sleeping, so concurrent acquirers space out rather than stack. */
    for (;;) {
      const t = now();
      const startAt = Math.max(t, nextStartAt, pausedUntil);
      nextStartAt = startAt + minGapMs;
      if (startAt <= t) return;
      const pauseSeen = pausedUntil;
      await sleep(startAt - t);
      /** A throttle that arrived while we slept moved the goalposts; honour it. */
      if (pausedUntil === pauseSeen) return;
    }
  }

  function release(): void {
    const next = waiters.shift();
    /** Hand the slot straight to the next waiter; `active` stays the same. */
    if (next) next();
    else active--;
  }

  async function gatedFetch(url: string, init?: RequestInit, opts?: { timeoutMs?: number }): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      await acquire();
      let res: Response;
      try {
        const signal = opts?.timeoutMs ? AbortSignal.timeout(opts.timeoutMs) : init?.signal;
        res = await doFetch(url, { ...init, signal });
      } finally {
        release();
      }
      if (!RETRY_STATUS.has(res.status) || attempt >= retries) return res;
      const asked = retryAfterMs(res.headers.get("retry-after"), now());
      const delay = Math.min(maxDelayMs, asked ?? baseDelayMs * 2 ** attempt);
      pausedUntil = Math.max(pausedUntil, now() + delay);
      try {
        await res.body?.cancel();
      } catch {
        /* the socket is freed either way */
      }
    }
  }

  return { fetch: gatedFetch, pending: () => active + queued };
}

/**
 * One identity for every request the app makes. There were four ("edexo-colonize/electron",
 * "…/spansh-typeahead", "…/spansh-fallback", and a descriptive one for EDSM only); a service
 * operator looking at their logs should see one app, described.
 */
export const USER_AGENT = "edexo-colonize/0.1 (Elite Dangerous colonisation companion)";

export const JSON_HEADERS: Readonly<Record<string, string>> = {
  Accept: "application/json",
  "User-Agent": USER_AGENT,
};

/** A non-2xx answer. `status` lets a caller tell "not there" from "not now". */
export class HttpStatusError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
  }
}

/** A failure worth asking again about later: throttled, a gateway error, or no answer at all. */
export function isTransientFetchError(e: unknown): boolean {
  if (e instanceof HttpStatusError) return e.status === 429 || e.status >= 500;
  return true;
}

/**
 * GET (or POST, with `body`) through a gate and parse JSON. A non-2xx answer throws
 * `HttpStatusError` after the gate has done its retrying, so a caller only decides what a final
 * status means.
 */
export async function fetchJson(
  gate: HttpGate,
  url: string,
  opts: { timeoutMs: number; body?: unknown },
): Promise<unknown> {
  const post = opts.body !== undefined;
  const res = await gate.fetch(
    url,
    {
      method: post ? "POST" : "GET",
      headers: post ? { ...JSON_HEADERS, "Content-Type": "application/json" } : JSON_HEADERS,
      body: post ? JSON.stringify(opts.body) : undefined,
    },
    { timeoutMs: opts.timeoutMs },
  );
  if (!res.ok) {
    await res.body?.cancel().catch(() => undefined);
    throw new HttpStatusError(res.status);
  }
  return await res.json();
}

/**
 * Spansh: two at a time. The persisted coordinate cache and batched EDSM look-ups took most of
 * the coordinate traffic off it, so this mostly carries commodity searches.
 */
export const spanshGate = createHttpGate({ concurrency: 2, retries: 3 });

/** EDSM: one at a time, 350 ms apart — the spacing the app has always used. */
export const edsmGate = createHttpGate({ concurrency: 1, minGapMs: 350, retries: 2 });

/**
 * Raven Colonial: a volunteer-run service with no published limits, so one request at a time,
 * half a second apart. It is only asked when the commander looks a site up.
 */
export const ravenGate = createHttpGate({ concurrency: 1, minGapMs: 500, retries: 2 });
