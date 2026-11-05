/**
 * Options › Look › Next boxel line (review P1, owner 2026-11-05: the switch moved here from the Boxels screen's top row,
 * which keeps only adding a boxel).
 */
import { FoldPanel } from "../ui/Fold";
import { useNextBoxelInHeader } from "../nextBoxelSetting";

export function NextBoxelSetting() {
  const [on, setOn] = useNextBoxelInHeader();
  return (
    <FoldPanel
      foldKey="options-next-boxel"
      defaultOpen={false}
      className="options-meta-block"
      title="Next boxel line"
      summary={on ? "On" : "Off"}
      help={
        <p>
          A line in the main screen&apos;s header: the boxel within 500 ly likely to pay most in first footfalls per jump,
          from the galaxy map&apos;s Expedition planner.
        </p>
      }
    >
      <label className="options-oneline">
        <input type="checkbox" checked={on} onChange={(ev) => setOn(ev.target.checked)} /> Show the next boxel in the main
        screen&apos;s header
      </label>
    </FoldPanel>
  );
}
