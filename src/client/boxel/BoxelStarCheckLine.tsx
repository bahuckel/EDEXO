import type { BoxelStarCheckDTO, SavedBoxelDTO } from "@shared/boxel";
import { predictedStarLabel, scannedStarText } from "./boxelLabels";

/** How many misses are spelled out per boxel; the rest are counted. */
const SHOWN = 5;

/**
 * The star predictions checked against your own scans (plan §3 item 4, owner 2026-11-24: "checks itself as he
 * flies"): per ticked boxel, how many of the arrival stars you scanned would have been predicted right from your
 * other scans in that boxel, and which were not.
 */
export function BoxelStarCheckLine({
  checks,
  byId,
}: {
  checks: readonly BoxelStarCheckDTO[];
  byId: ReadonlyMap<string, SavedBoxelDTO>;
}) {
  const shown = checks.filter((c) => c.checked > 0);
  if (!shown.length) return null;
  return (
    <p
      className="boxel-order dim"
      title="Each star you scanned is predicted from your other scans in its boxel, never from its own, and compared with what you found."
    >
      Star predictions against your scans:{" "}
      {shown.map((c, i) => {
        const b = byId.get(c.boxelId);
        const suffix = b ? b.prefix.slice(b.prefix.lastIndexOf(" ") + 1) : "";
        return (
          <span key={c.boxelId}>
            {i ? " " : ""}
            <strong>
              {c.right.toLocaleString("en-US")} of {c.checked.toLocaleString("en-US")} right
            </strong>
            {b ? ` in ${b.boxel}` : ""}
            {c.misses.length ? " (" : ""}
            {c.misses.slice(0, SHOWN).map((m, j) => (
              <span key={m.n}>
                {j ? "; " : ""}
                {suffix}
                {m.n}: predicted {predictedStarLabel(m.predicted).text}, found {scannedStarText(m.real)}
              </span>
            ))}
            {c.misses.length > SHOWN ? `; ${(c.misses.length - SHOWN).toLocaleString("en-US")} more` : ""}
            {c.misses.length ? ")" : ""}.
          </span>
        );
      })}
    </p>
  );
}
