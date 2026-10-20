/**
 * The server's side of the candidate search's worker thread (finderWorker.ts): started on the first search, ended
 * with the galaxy map's other caches and before a downloaded file replaces the old one (Windows will not replace a
 * file the worker has open). When there is no worker file to start (a test run, the console builds) or the worker
 * fails, the request runs here in the server's own thread instead, as before.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { Worker } from "node:worker_threads";
import type { FinderResult } from "../shared/finder.js";
import { onFinderIndexClear } from "./finderIndex.js";
import type { FinderRef } from "./finderSearch.js";
import { closeFinderWorkerIndex, handleFinderRequest, type FinderWorkerRequest } from "./finderWorker.js";

/** Where this code runs from: build/app.cjs's folder in the app, src/server under tsx. */
function ownDir(): string {
  if (typeof __dirname === "string" && __dirname.length > 0) return __dirname;
  return process.argv[1] ? path.dirname(process.argv[1]) : process.cwd();
}

/** The worker's file beside the server: the bundle's (scripts/bundle.mjs) or the source under tsx. */
export function finderWorkerFile(dir = ownDir()): string | null {
  for (const name of ["finder-worker.cjs", "finderWorker.ts"]) {
    const p = path.join(dir, name);
    if (existsSync(p)) return p;
  }
  return null;
}

/** The worker could not take the request or broke under it: the caller runs it in-process instead. */
class WorkerGone extends Error {}

type Pending = { w: Worker; resolve: (v: unknown) => void; reject: (e: Error) => void };
let worker: Worker | null = null;
/** The worker could not start or broke: the rest of this run searches in-process. */
let unavailable = false;
let seq = 0;
const pending = new Map<number, Pending>();

/** Reject what `w` was asked (a stopped worker's late exit must not touch its successor's requests). */
function failAll(w: Worker, e: Error): void {
  for (const [id, p] of pending) {
    if (p.w !== w) continue;
    pending.delete(id);
    p.reject(e);
  }
}

function startWorker(): Worker | null {
  if (worker) return worker;
  if (unavailable) return null;
  const file = finderWorkerFile();
  if (!file) {
    unavailable = true;
    return null;
  }
  let w: Worker;
  try {
    w = new Worker(file);
  } catch {
    unavailable = true;
    return null;
  }
  w.unref();
  w.on("message", (m: { id: number; ok: boolean; result?: unknown; error?: string }) => {
    const p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    if (m.ok) p.resolve(m.result);
    else p.reject(new Error(m.error ?? "search failed"));
  });
  w.on("error", (e) => {
    unavailable = true;
    if (worker === w) worker = null;
    failAll(w, new WorkerGone(e instanceof Error ? e.message : String(e)));
  });
  w.on("exit", () => {
    if (worker === w) worker = null;
    failAll(w, new WorkerGone("the search worker ended"));
  });
  worker = w;
  return w;
}

async function inWorker(req: FinderWorkerRequest): Promise<unknown> {
  const w = startWorker();
  if (!w) throw new WorkerGone("no worker");
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { w, resolve, reject });
    w.postMessage({ id, req });
  });
}

/** Run one request in the worker, else here. A search's own error (a broken file) is not retried. */
async function run(req: FinderWorkerRequest): Promise<unknown> {
  try {
    return await inWorker(req);
  } catch (e) {
    if (e instanceof WorkerGone) return handleFinderRequest(req);
    throw e;
  }
}

export function searchFinderOffThread(
  req: Omit<Extract<FinderWorkerRequest, { op: "search" }>, "op">,
): Promise<FinderResult> {
  return run({ op: "search", ...req }) as Promise<FinderResult>;
}

export function findInFinderOffThread(file: string, size: number, name: string): Promise<FinderRef | null> {
  return run({ op: "find", file, size, name }) as Promise<FinderRef | null>;
}

/** End the worker (its memory with it) and close the in-process fallback's file. */
export async function stopFinderWorker(): Promise<void> {
  const w = worker;
  worker = null;
  if (w) {
    // Not retried in-process: a stop comes before the file is replaced, and a retry would open it again.
    failAll(w, new Error("The search was stopped (the search data is being replaced or put away)."));
    await w.terminate().catch(() => 0);
  }
  await closeFinderWorkerIndex();
}

onFinderIndexClear(stopFinderWorker);
