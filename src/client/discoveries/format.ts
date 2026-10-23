/**
 * The cell formatters the three discoveries tabs share (moved out of DiscoveriesTables.tsx, audit
 * 2026-10-22).
 */
import { fmtCrExact } from "@shared/format";

export const cr = fmtCrExact;
export const num = (n: number | null | undefined, digits = 0) =>
  n == null || !Number.isFinite(n) ? "—" : n.toLocaleString(undefined, { maximumFractionDigits: digits });
export const date = (iso: string | null) => (iso ? iso.slice(0, 10) : "—");

/** `—` for a zero count, so a dense table reads as data rather than as a field of noughts. */
export const count = (n: number) => (n > 0 ? n.toLocaleString() : "—");
