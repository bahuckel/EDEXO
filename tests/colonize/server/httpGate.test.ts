import { describe, expect, it } from "vitest";
import { createHttpGate, fetchJson, HttpStatusError, isTransientFetchError, retryAfterMs, USER_AGENT } from "../../../src/server/colonize/httpGate";

/** A clock that only moves when the gate sleeps, so spacing and pauses are exact. */
function fakeClock() {
  let t = 1_000_000;
  const sleeps: number[] = [];
  return {
    now: () => t,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      t += ms;
    },
    sleeps,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

function res(status: number, headers: Record<string, string> = {}): Response {
  return new Response(status === 200 ? "{}" : "", { status, headers });
}

describe("retryAfterMs", () => {
  it("reads delta-seconds", () => {
    expect(retryAfterMs("3", 0)).toBe(3000);
    expect(retryAfterMs(" 1.5 ", 0)).toBe(1500);
  });
  it("reads an HTTP date relative to now", () => {
    const now = Date.parse("2026-09-23T12:00:00Z");
    expect(retryAfterMs("Wed, 23 Sep 2026 12:00:07 GMT", now)).toBe(7000);
    expect(retryAfterMs("Wed, 23 Sep 2026 11:00:00 GMT", now)).toBe(0);
  });
  it("ignores what it cannot read", () => {
    expect(retryAfterMs(null, 0)).toBeNull();
    expect(retryAfterMs("", 0)).toBeNull();
    expect(retryAfterMs("soon", 0)).toBeNull();
  });
});

describe("createHttpGate", () => {
  it("never has more requests in flight than its concurrency", async () => {
    let inFlight = 0;
    let peak = 0;
    const gate = createHttpGate({
      concurrency: 2,
      fetchImpl: async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight--;
        return res(200);
      },
    });
    const all = await Promise.all(Array.from({ length: 7 }, (_, i) => gate.fetch(`u${i}`)));
    expect(all.every((r) => r.status === 200)).toBe(true);
    expect(peak).toBe(2);
    expect(gate.pending()).toBe(0);
  });

  it("spaces request starts by minGapMs", async () => {
    const clock = fakeClock();
    const starts: number[] = [];
    const gate = createHttpGate({
      concurrency: 1,
      minGapMs: 350,
      now: clock.now,
      sleep: clock.sleep,
      fetchImpl: async () => {
        starts.push(clock.now());
        return res(200);
      },
    });
    await Promise.all([gate.fetch("a"), gate.fetch("b"), gate.fetch("c")]);
    expect(starts.map((s) => s - starts[0]!)).toEqual([0, 350, 700]);
  });

  it("waits as long as Retry-After asks, then retries", async () => {
    const clock = fakeClock();
    const answers = [res(429, { "Retry-After": "3" }), res(200)];
    let calls = 0;
    const gate = createHttpGate({
      concurrency: 1,
      retries: 2,
      now: clock.now,
      sleep: clock.sleep,
      fetchImpl: async () => answers[calls++]!,
    });
    const r = await gate.fetch("x");
    expect(r.status).toBe(200);
    expect(calls).toBe(2);
    expect(clock.sleeps).toEqual([3000]);
  });

  it("backs off exponentially without Retry-After and gives up after `retries`", async () => {
    const clock = fakeClock();
    let calls = 0;
    const gate = createHttpGate({
      concurrency: 1,
      retries: 2,
      baseDelayMs: 100,
      now: clock.now,
      sleep: clock.sleep,
      fetchImpl: async () => {
        calls++;
        return res(503);
      },
    });
    const r = await gate.fetch("x");
    expect(r.status).toBe(503);
    expect(calls).toBe(3);
    expect(clock.sleeps).toEqual([100, 200]);
  });

  it("caps a pause the server asks for", async () => {
    const clock = fakeClock();
    const answers = [res(429, { "Retry-After": "3600" }), res(200)];
    let calls = 0;
    const gate = createHttpGate({
      concurrency: 1,
      retries: 1,
      maxDelayMs: 30_000,
      now: clock.now,
      sleep: clock.sleep,
      fetchImpl: async () => answers[calls++]!,
    });
    await gate.fetch("x");
    expect(clock.sleeps).toEqual([30_000]);
  });

  it("does not retry a plain 500 — Spansh's answer to the symbol filter", async () => {
    let calls = 0;
    const gate = createHttpGate({
      concurrency: 1,
      retries: 3,
      fetchImpl: async () => {
        calls++;
        return res(500);
      },
    });
    expect((await gate.fetch("x")).status).toBe(500);
    expect(calls).toBe(1);
  });

  it("a throttle pauses every other request on the gate, not just the one that hit it", async () => {
    /** Time stands still and sleeps are released by hand, so "b" is asked for mid-pause. */
    const t = 1_000_000;
    const sleeping: Array<{ ms: number; wake: () => void }> = [];
    const started: string[] = [];
    let first = true;
    const gate = createHttpGate({
      concurrency: 2,
      retries: 1,
      now: () => t,
      sleep: (ms) => new Promise<void>((wake) => sleeping.push({ ms, wake })),
      fetchImpl: async (url) => {
        started.push(String(url));
        if (url === "a" && first) {
          first = false;
          return res(429, { "Retry-After": "5" });
        }
        return res(200);
      },
    });
    const settle = () => new Promise((r) => setTimeout(r, 0));
    const a = gate.fetch("a");
    await settle();
    expect(sleeping.map((s) => s.ms)).toEqual([5000]);

    /** A free slot exists, but the host said wait: "b" must wait too. */
    const b = gate.fetch("b");
    await settle();
    expect(started).toEqual(["a"]);
    expect(sleeping.map((s) => s.ms)).toEqual([5000, 5000]);

    for (const s of sleeping) s.wake();
    await Promise.all([a, b]);
    expect(started.sort()).toEqual(["a", "a", "b"]);
  });

  it("releases its slot when fetch throws", async () => {
    let calls = 0;
    const gate = createHttpGate({
      concurrency: 1,
      fetchImpl: async () => {
        calls++;
        if (calls === 1) throw new Error("ECONNRESET");
        return res(200);
      },
    });
    await expect(gate.fetch("a")).rejects.toThrow("ECONNRESET");
    expect((await gate.fetch("b")).status).toBe(200);
    expect(gate.pending()).toBe(0);
  });

  it("starts the timeout when the request leaves the queue", async () => {
    const signals: Array<AbortSignal | null | undefined> = [];
    const gate = createHttpGate({
      concurrency: 1,
      fetchImpl: async (_u, init) => {
        signals.push(init?.signal);
        return res(200);
      },
    });
    await gate.fetch("a", undefined, { timeoutMs: 10_000 });
    expect(signals[0]).toBeInstanceOf(AbortSignal);
    expect(signals[0]!.aborted).toBe(false);
  });
});

describe("fetchJson", () => {
  it("GETs with the app's one identity and parses the body", async () => {
    let seen: RequestInit | undefined;
    const gate = createHttpGate({
      concurrency: 1,
      fetchImpl: async (_u, init) => {
        seen = init;
        return new Response(JSON.stringify({ hello: "sol" }), { status: 200 });
      },
    });
    expect(await fetchJson(gate, "https://example.test/x", { timeoutMs: 1000 })).toEqual({ hello: "sol" });
    expect(seen?.method).toBe("GET");
    expect((seen?.headers as Record<string, string>)["User-Agent"]).toBe(USER_AGENT);
    expect(seen?.body).toBeUndefined();
  });

  it("POSTs a body as JSON", async () => {
    let seen: RequestInit | undefined;
    const gate = createHttpGate({
      concurrency: 1,
      fetchImpl: async (_u, init) => {
        seen = init;
        return new Response("{}", { status: 200 });
      },
    });
    await fetchJson(gate, "https://example.test/x", { timeoutMs: 1000, body: { page: 1 } });
    expect(seen?.method).toBe("POST");
    expect((seen?.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    expect(seen?.body).toBe(JSON.stringify({ page: 1 }));
  });

  it("throws the final status so the caller can tell 'not there' from 'not now'", async () => {
    const gate = createHttpGate({ concurrency: 1, fetchImpl: async () => new Response("", { status: 404 }) });
    const err = await fetchJson(gate, "https://example.test/x", { timeoutMs: 1000 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpStatusError);
    expect((err as HttpStatusError).status).toBe(404);
    expect(isTransientFetchError(err)).toBe(false);
    expect(isTransientFetchError(new HttpStatusError(429))).toBe(true);
    expect(isTransientFetchError(new HttpStatusError(503))).toBe(true);
    expect(isTransientFetchError(new TypeError("fetch failed"))).toBe(true);
  });
});
