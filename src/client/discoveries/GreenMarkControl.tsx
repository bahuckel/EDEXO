/**
 * The commander's own green gas giant call on a Bodies row (moved out of DiscoveriesTables.tsx, audit
 * 2026-10-22).
 */
import type { GreenGiantMark, GreenGiantVerdict } from "@shared/greenGasGiant";
import type { DiscoveryBodyRow } from "@shared/types";

export interface GreenEdit {
  verdict: GreenGiantVerdict | null;
  mark: GreenGiantMark | null;
}

/**
 * "Green? Yes / No" on a gas giant of a class that can be green. Always shown on a candidate or a body
 * already marked; on the others it appears on hover or keyboard focus, so 2,000 gas giants do not
 * each carry two buttons. Pressing the chosen answer again clears it.
 */
export function GreenMarkControl({
  row,
  state,
  onMark,
}: {
  row: DiscoveryBodyRow;
  state: GreenEdit;
  onMark: (r: DiscoveryBodyRow, mark: GreenGiantMark | null) => void;
}) {
  const quiet = !state.verdict && !state.mark;
  return (
    <span className={`disc-ggg-mark${quiet ? " disc-ggg-mark--quiet" : ""}`} role="group" aria-label="Is it a green gas giant?">
      <span className="dim">green?</span>
      <button
        type="button"
        aria-pressed={state.mark === "yes"}
        title="You saw it green: confirmed"
        onClick={() => onMark(row, state.mark === "yes" ? null : "yes")}
      >
        Yes
      </button>
      <button
        type="button"
        aria-pressed={state.mark === "no"}
        title="Not green: drops a guess (never a codex entry or the edGGG catalogue)"
        onClick={() => onMark(row, state.mark === "no" ? null : "no")}
      >
        No
      </button>
    </span>
  );
}
