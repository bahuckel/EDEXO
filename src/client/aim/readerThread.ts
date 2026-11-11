/**
 * A reader's own worker (readerWorker.ts): the page crops the frame and hands the pixels over, the worker reads them,
 * and the marks keep moving meanwhile (the readers took 10-350 ms a frame on the page's thread). Where a worker cannot
 * start (no Worker, a failed load) the jobs run on the page as before, the glyph tables loaded then.
 */
import type { ReaderJob, ReaderResult } from "./readerJobs";

export interface ReaderThread {
  /** Read; the job's pixels are handed to the worker (unusable here afterwards). */
  run<J extends ReaderJob>(job: J): Promise<ReaderResult<J>>;
  stop(): void;
}

/**
 * Whether the game runs and is in front (Electron's foreground watcher, aimWindow.cjs). True until told otherwise:
 * outside the desktop app nothing tells, and the readers read as before.
 */
let gameInFront = true;
export function setGameInFront(on: boolean): void {
  gameInFront = on;
}

/**
 * `read` every `ms`; a frame still being read when the next is due makes the next one skipped, not queued behind it.
 * Nothing is read while another program is in front (review 2026-11-10 E3): the capture then shows that program, and
 * nothing read there is the game's. Returns the interval's id for clearInterval.
 */
export function readEvery(ms: number, read: () => Promise<void>): ReturnType<typeof setInterval> {
  let busy = false;
  return setInterval(() => {
    if (busy || !gameInFront) return;
    busy = true;
    void read().finally(() => {
      busy = false;
    });
  }, ms);
}

type Answer = { id: number; result?: unknown; error?: string };

function inline(): ReaderThread {
  const jobs = import("./readerJobs");
  return {
    run: async (job) => (await jobs).runReaderJob(job),
    stop() {},
  };
}

export function startReaderThread(): ReaderThread {
  let worker: Worker;
  try {
    if (typeof Worker === "undefined") return inline();
    worker = new Worker(new URL("./readerWorker.ts", import.meta.url), { type: "module" });
  } catch {
    return inline();
  }
  let next = 1;
  const waiting = new Map<number, { resolve: (r: unknown) => void; reject: (e: Error) => void }>();
  /* The worker failed to load or died: what waits fails, and every later job runs on the page. */
  let fallback: ReaderThread | null = null;
  const fail = (why: string) => {
    fallback ??= inline();
    worker.terminate();
    for (const w of waiting.values()) w.reject(new Error(why));
    waiting.clear();
  };
  worker.onmessage = (e: MessageEvent<Answer>) => {
    const w = waiting.get(e.data.id);
    if (!w) return;
    waiting.delete(e.data.id);
    if (e.data.error != null) w.reject(new Error(e.data.error));
    else w.resolve(e.data.result);
  };
  worker.onerror = (e) => {
    e.preventDefault();
    fail(e.message || "reader worker failed");
  };
  return {
    run<J extends ReaderJob>(job: J): Promise<ReaderResult<J>> {
      if (fallback) return fallback.run(job);
      const id = next++;
      return new Promise((resolve, reject) => {
        waiting.set(id, { resolve: resolve as (r: unknown) => void, reject });
        worker.postMessage({ id, job }, [job.px.buffer as ArrayBuffer]);
      });
    },
    stop() {
      worker.terminate();
      for (const w of waiting.values()) w.reject(new Error("stopped"));
      waiting.clear();
    },
  };
}
