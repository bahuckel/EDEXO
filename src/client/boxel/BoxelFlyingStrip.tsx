/**
 * One "Flying" strip under the Boxels summary (review P3, owner 2026-11-05): the next system to fly, the order the boxel
 * is flown in, the copy after each jump, and the run. Before, "Copy after each jump" (for every boxel) sat in one
 * boxel's summary and Start run in the side rows. "Copied" shows only when it is not the next to fly (P7).
 */
import type { SavedBoxelDTO } from "@shared/boxel";
import { CopySystemButton } from "../CopySystemButton";

export function BoxelFlyingStrip({
  lead,
  several,
  run,
  lastCopied,
  autoCopy,
  onAutoCopy,
  onPatch,
}: {
  /** The boxel the strip is about: the one you are in, else the first ticked. */
  lead: SavedBoxelDTO;
  /** More than one boxel ticked: the order switch names the one it changes. */
  several: boolean;
  /** The boxel being run, any of them. */
  run: SavedBoxelDTO | null;
  lastCopied: { name: string; at: string; run: boolean } | null;
  autoCopy: boolean | null;
  onAutoCopy: (on: boolean) => void;
  onPatch: (id: string, body: Record<string, unknown>) => void;
}) {
  const showCopied = lastCopied && lastCopied.name.toLowerCase() !== (lead.next ?? "").toLowerCase();
  return (
    <div className="boxel-flying" role="group" aria-label="Flying">
      {lead.next ? (
        <span className="boxel-next">
          <span className="dim">Next to fly </span>
          <strong>{lead.next}</strong>
          <CopySystemButton system={lead.next} />
        </span>
      ) : (
        <span className="dim">Nothing left to fly in {lead.boxel}</span>
      )}
      {showCopied ? (
        <span className="boxel-next" title={`Put on the clipboard ${lastCopied.at.slice(11, 19)} by a jump or a boxel key (F6–F9)`}>
          <span className="dim">Copied </span>
          <strong>{lastCopied.name}</strong>
          {lastCopied.run ? <span className="boxel-side__here">run</span> : null}
        </span>
      ) : null}
      <span
        className="boxel-flying__order"
        role="radiogroup"
        aria-label={`Order${several ? ` for ${lead.boxel}` : ""}`}
        title="Shortest: this boxel's systems in the shortest order from where you are, not by number. Positions come from routes you plotted in the galaxy map (Plot route, not only Set target) and from Spansh; systems with no position follow by number. The next system, F6 and F8 / F9 follow the order."
      >
        <span className="dim">Order{several ? ` for ${lead.boxel}` : ""} </span>
        {(
          [
            [false, "By number"],
            [true, "Shortest"],
          ] as const
        ).map(([on, label]) => (
          <button
            key={label}
            type="button"
            role="radio"
            aria-checked={!!lead.shortest === on}
            className={`fdb-chip${!!lead.shortest === on ? " fdb-chip--on" : ""}`}
            onClick={() => !!lead.shortest !== on && onPatch(lead.id, { shortest: on })}
          >
            {label}
          </button>
        ))}
      </span>
      {autoCopy != null ? (
        <label
          className="boxel-autocopy dim tiny"
          title="Desktop app: after each jump into a saved boxel, the next system to fly is put on the clipboard, ready to paste in the galaxy map. F6 copies it again (Launcher → Key binds)."
        >
          <input type="checkbox" checked={autoCopy} onChange={(ev) => onAutoCopy(ev.target.checked)} /> Copy after each jump
        </label>
      ) : null}
      {run ? (
        <span className="boxel-flying__run">
          <span className="dim">Run </span>
          <strong>{run.boxel}</strong>
          <button type="button" className="fdb-chip fdb-chip--on" title="Finish the boxel run (F7 in the game)" onClick={() => onPatch(run.id, { run: false })}>
            Finish
          </button>
        </span>
      ) : (
        <button
          type="button"
          className="fdb-chip"
          title="Start a boxel run: after every jump its next system is on the clipboard, wherever you are (F7 in the game; F8 / F9 step through its systems)"
          onClick={() => onPatch(lead.id, { run: true })}
        >
          Start run on {lead.boxel}
        </button>
      )}
    </div>
  );
}
