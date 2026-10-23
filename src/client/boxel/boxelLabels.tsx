/**
 * The Boxels screen's labels, page sizes and small helpers (moved out of Boxel.tsx, audit 2026-10-22).
 */
import type { BoxelTableRowDTO } from "@shared/boxel";
import { NOTABLE_KINDS, type NotableKind } from "@shared/notices";
import { STAR_CLASSES } from "@shared/galaxyTraits";
import { isStrArr } from "../usePersistedState";

export const NOTABLE_LABEL = Object.fromEntries(NOTABLE_KINDS.map((k) => [k.key, k.label])) as Record<
  NotableKind,
  string
>;

export const FROM_TITLE = {
  index: "From the galaxy index (EDSM / Spansh records)",
  lookup: "From Spansh (Look up)",
  route: "From a route you plotted or a system you targeted in the galaxy map: the main star's class only",
} as const;

/** A fact from the galaxy index or a Spansh look-up (not your own scan) reads dimmer, and says so on hover. */
export function fromIndex(r: BoxelTableRowDTO, text: string) {
  return r.from === "index" || r.from === "lookup" || r.from === "route" ? (
    <span className="boxel-from-index" title={FROM_TITLE[r.from]}>
      {text}
    </span>
  ) : (
    <span>{text}</span>
  );
}

/** Previous boxels drawn at once: a long log holds thousands. */
export const PREV_PAGE = 60;
export const PREV_RANGES: { days: number; label: string }[] = [
  { days: 1, label: "24h" },
  { days: 7, label: "7d" },
  { days: 30, label: "30d" },
  { days: 90, label: "90d" },
  { days: 365, label: "365d" },
  { days: 0, label: "All" },
];
export const STAR_LABEL = Object.fromEntries(STAR_CLASSES.map((c) => [c.key, c.label])) as Record<string, string>;

export type SideTab = "saved" | "explored" | "history";

/** Other stars listed in a row before "+N more". */
export const OTHER_STARS_SHOWN = 2;

export const isIncluded = (v: unknown): v is string[] | null => v === null || isStrArr(v);
export const json = { "Content-Type": "application/json" };
