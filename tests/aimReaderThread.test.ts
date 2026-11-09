/**
 * The screen marker's readers in a worker (src/client/aim/readerThread.ts, plan §4.3.5): a job's pixels handed over
 * and its answer matched back by id, a worker that fails to load or dies leaving the jobs to run on the page, and a
 * frame due while one is still being read skipped rather than queued.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { readEvery, startReaderThread } from "../src/client/aim/readerThread.js";
import type { ReaderJob } from "../src/client/aim/readerJobs.js";

type Posted = { data: { id: number; job: ReaderJob }; transfer: Transferable[] };

class FakeWorker {
  static last: FakeWorker | null = null;
  posted: Posted[] = [];
  terminated = false;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: ((e: { message: string; preventDefault(): void }) => void) | null = null;
  constructor(
    readonly url: URL,
    readonly opts: { type?: string },
  ) {
    FakeWorker.last = this;
  }
  postMessage(data: Posted["data"], transfer: Transferable[]) {
    this.posted.push({ data, transfer });
  }
  terminate() {
    this.terminated = true;
  }
  answer(data: unknown) {
    this.onmessage?.({ data });
  }
}

const blank = (w = 40, h = 30) => new Uint8ClampedArray(w * h * 4);
const distanceJob = (): ReaderJob => ({ kind: "distance", px: blank(), w: 40, h: 30, screenH: 30, colour: null, hint: null });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  FakeWorker.last = null;
});

describe("reader thread", () => {
  it("hands the pixels to a module worker and matches each answer to its job", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    const t = startReaderThread();
    const w = FakeWorker.last!;
    expect(w.opts.type).toBe("module");
    expect(w.url.pathname).toMatch(/readerWorker\.ts$/);
    const a = distanceJob();
    const b = distanceJob();
    const ra = t.run(a);
    const rb = t.run(b);
    expect(w.posted.map((p) => p.data.id)).toEqual([1, 2]);
    expect(w.posted[0]!.transfer).toEqual([a.px.buffer]);
    w.answer({ id: 2, result: { reading: "second" } });
    w.answer({ id: 1, error: "bad frame" });
    await expect(rb).resolves.toEqual({ reading: "second" });
    await expect(ra).rejects.toThrow("bad frame");
    t.stop();
    expect(w.terminated).toBe(true);
  });

  it("runs the jobs on the page once the worker fails", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    const t = startReaderThread();
    const w = FakeWorker.last!;
    const waiting = t.run(distanceJob());
    w.onerror!({ message: "load failed", preventDefault() {} });
    await expect(waiting).rejects.toThrow("load failed");
    expect(w.terminated).toBe(true);
    // A blank frame reads as nothing, on the page now.
    await expect(t.run(distanceJob())).resolves.toBeNull();
    expect(w.posted).toHaveLength(1);
  });

  it("runs on the page without Worker, with the same readers", async () => {
    vi.stubGlobal("Worker", undefined);
    const t = startReaderThread();
    await expect(t.run(distanceJob())).resolves.toBeNull();
    await expect(t.run({ kind: "heading", px: blank(), w: 40, h: 30, ox: 0, oy: 0, screen: { w: 40, h: 30 } })).resolves.toBeNull();
    await expect(
      t.run({ kind: "pitch", px: blank(), w: 40, h: 30, screen: { w: 40, h: 30 }, colours: null, discover: true, hint: null }),
    ).resolves.toBeNull();
  });

  it("skips a frame due while the last is still being read", async () => {
    vi.useFakeTimers();
    let done: () => void = () => {};
    const read = vi.fn(() => new Promise<void>((r) => (done = r)));
    const timer = readEvery(250, read);
    await vi.advanceTimersByTimeAsync(1000);
    expect(read).toHaveBeenCalledTimes(1);
    done();
    await vi.advanceTimersByTimeAsync(250);
    expect(read).toHaveBeenCalledTimes(2);
    clearInterval(timer);
  });
});
