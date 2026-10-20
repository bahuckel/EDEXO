/**
 * The Colonisation candidate search, run in a worker thread of its own (owner, 2026-10-19: "All colonised" stayed on
 * the old list for about 1.5 minutes in the desktop app).
 *
 * A search round every colonised system reads the whole file: ~7,000 blocks, ~500 MB unpacked, each block a fresh
 * buffer. In the app's server — an Electron utility process holding the journals and the galaxy map's data — every
 * one of those buffers is expensive and the garbage collector walks that big heap again and again: measured on a
 * windowless copy of the server, 33 of 70 s went to making buffers and 14 s to collecting, the search itself under
 * one. The same search in a process with a small heap takes about a second. Here it gets that small heap, and the
 * server's thread stays free while it runs.
 *
 * Messages in: {@link FinderWorkerRequest}; out: `{ id, ok, result }` or `{ id, ok: false, error }`. The file is
 * opened per (path, size), so a downloaded update is picked up; "all colonised" references are read once per file.
 */
import { isMainThread, parentPort } from "node:worker_threads";
import type { FinderQuery, FinderResult } from "../shared/finder.js";
import { FinderIndex } from "./finderIndex.js";
import { colonisedRefs, findInFinder, searchFinder, type FinderRef } from "./finderSearch.js";

export type FinderWorkerRequest =
  | {
      op: "search";
      file: string;
      size: number;
      q: FinderQuery;
      /** null: every colonised system in the file (read here, kept here). */
      refs: FinderRef[] | null;
      knownClaimedNames: string[];
    }
  | { op: "find"; file: string; size: number; name: string };

let index: FinderIndex | null = null;
let indexKey = "";
let colonised: Promise<FinderRef[]> | null = null;

function openIndex(file: string, size: number): FinderIndex {
  const key = `${file}|${size}`;
  if (index && indexKey === key) return index;
  void index?.clearCache();
  index = FinderIndex.open(file);
  indexKey = key;
  colonised = null;
  return index;
}

/** One request, in whatever thread calls it (the worker; tests call it directly). */
export async function handleFinderRequest(req: FinderWorkerRequest): Promise<FinderResult | FinderRef | null> {
  const idx = openIndex(req.file, req.size);
  if (req.op === "find") return findInFinder(idx, req.name);
  let refs = req.refs;
  if (!refs) {
    colonised ??= colonisedRefs(idx);
    refs = await colonised;
  }
  return searchFinder(idx, req.q, refs, {
    knownClaimed: { ids: new Set(), names: new Set(req.knownClaimedNames) },
    precomputedColonised: req.refs === null,
  });
}

/** Close the file (the worker is ending, or a test is done with it). */
export function closeFinderWorkerIndex(): Promise<void> {
  const closing = index?.clearCache() ?? Promise.resolve();
  index = null;
  indexKey = "";
  colonised = null;
  return closing;
}

if (!isMainThread && parentPort) {
  const port = parentPort;
  port.on("message", (m: { id: number; req: FinderWorkerRequest }) => {
    handleFinderRequest(m.req).then(
      (result) => port.postMessage({ id: m.id, ok: true, result }),
      (e: unknown) => port.postMessage({ id: m.id, ok: false, error: e instanceof Error ? e.message : String(e) }),
    );
  });
}
