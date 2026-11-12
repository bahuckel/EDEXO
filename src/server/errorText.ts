/*
  An error's message for a log line or an answer, and the route's 500 that carries it (plan 2026-11-10 Phase 7.4;
  review 2026-11-07 §8.6, S2: 82 copies of the expression, 16 of the whole answer).
*/
import type express from "express";

export function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** `500 { ok: false, error }`: the answer a route gives when what it called threw. */
export function fail(res: express.Response, e: unknown): void {
  res.status(500).json({ ok: false, error: errorText(e) });
}
