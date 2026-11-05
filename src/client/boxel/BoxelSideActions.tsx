/**
 * A saved boxel's actions, behind one "⋯" on its side-menu row (review P2, owner 2026-11-05: a row could show seven
 * buttons). The row keeps the name, the bar and the counts; here: fetch from Spansh, start or finish a run, check the
 * end in the galaxy map (P5's wording: copy the number past the end, or say the map does not have it), set the last
 * system (P1: the top row only adds boxels now), delete.
 */
import { useState } from "react";
import type { SavedBoxelDTO } from "@shared/boxel";
import { Popover } from "../ui/Popover";

export function BoxelSideActions({
  b,
  lookedAt,
  lookupRunning,
  copied,
  onCopy,
  onLookUp,
  onPatch,
  onSetEnd,
  onDelete,
}: {
  b: SavedBoxelDTO;
  /** When it was last fetched from Spansh, and how many systems came. */
  lookedAt: { fetchedAt: string; systems: number } | undefined;
  lookupRunning: boolean;
  /** The text last copied, for the button's "Copied". */
  copied: string | null;
  onCopy: (text: string) => void;
  onLookUp: () => void;
  onPatch: (body: Record<string, unknown>) => void;
  onSetEnd: (n: number) => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [end, setEnd] = useState("");
  const [sure, setSure] = useState(false);
  const close = () => {
    setOpen(false);
    setSure(false);
    setEnd("");
  };
  const n = Number(end);
  const endOk = end !== "" && Number.isInteger(n) && n >= 0;
  return (
    <Popover
      open={open}
      onOpenChange={(o) => (o ? setOpen(true) : close())}
      label={`${b.boxel} ${b.sector}`}
      className="boxel-side__menu"
      side="right"
      portal
      contained
      trigger={
        <button type="button" className="fdb-chip boxel-side__more" aria-label={`What to do with ${b.boxel}`} title="Fetch from Spansh, run, end, delete">
          ⋯
        </button>
      }
    >
      <button
        type="button"
        className="fdb-chip"
        disabled={lookupRunning}
        title={
          lookedAt
            ? `Fetched from Spansh ${lookedAt.fetchedAt.slice(0, 10)} (${lookedAt.systems} systems): fetch again`
            : "Fill the systems you have not flown from Spansh: stars, every body, species logged (a few requests, five seconds apart)"
        }
        onClick={() => {
          onLookUp();
          close();
        }}
      >
        {lookedAt ? "Fetch from Spansh again" : "Fetch from Spansh"}
      </button>
      <button
        type="button"
        className={`fdb-chip${b.run ? " fdb-chip--on" : ""}`}
        title={
          b.run
            ? "Finish the boxel run (F7 in the game)"
            : "Start a boxel run here: after every jump its next system is on the clipboard, wherever you are (F7 in the game; F8 / F9 step through its systems)"
        }
        onClick={() => {
          onPatch({ run: !b.run });
          close();
        }}
      >
        {b.run ? "Finish run" : "Start run"}
      </button>
      {/*
        Finding the boxel's last system in the galaxy map (owner, 2026-10-06; ideas from EDJP and SHBOXSEARCH): the
        number after the end. Found: plot or target it and the boxel extends itself. Not found: the end is known.
      */}
      {b.probe ? (
        <div className="boxel-side__menu-group" role="group" aria-label="Check the end">
          <span className="dim tiny">Check the end ▸</span>
          <button
            type="button"
            className={`fdb-chip${copied === b.probe ? " fdb-chip--on" : ""}`}
            title={`Copies ${b.probe}: search it in the galaxy map. Found: plot a route to it or target it, and the boxel extends itself. Not found: say so with the next button.`}
            onClick={() => onCopy(b.probe!)}
          >
            {copied === b.probe ? "Copied" : `Copy -${b.end + 1} to search the map`}
          </button>
          <button
            type="button"
            className="fdb-chip"
            title={`The galaxy map did not find ${b.probe}: -${b.end} is this boxel's last system`}
            onClick={() => {
              onPatch({ lastIs: b.end });
              close();
            }}
          >
            -{b.end + 1} isn&apos;t in the map
          </button>
        </div>
      ) : null}
      <form
        className="boxel-side__menu-group"
        onSubmit={(ev) => {
          ev.preventDefault();
          if (!endOk) return;
          onSetEnd(n);
          close();
        }}
      >
        <label className="dim tiny" htmlFor={`boxel-end-${b.id}`}>
          Last system
        </label>
        <input
          id={`boxel-end-${b.id}`}
          className="carriers-search__input boxel-side__end"
          inputMode="numeric"
          value={end}
          placeholder={String(b.end)}
          title="The boxel's last system number: the list ends there (a higher one flown or plotted still shows)"
          onChange={(ev) => setEnd(ev.target.value.replace(/\D/g, ""))}
        />
        <button type="submit" className="fdb-chip" disabled={!endOk}>
          Set
        </button>
      </form>
      {sure ? (
        <div className="boxel-side__menu-group">
          <button type="button" className="fdb-chip boxel-del" onClick={onDelete}>
            Delete {b.boxel}
          </button>
          <button type="button" className="fdb-chip" onClick={() => setSure(false)}>
            Cancel
          </button>
        </div>
      ) : (
        <button type="button" className="fdb-chip boxel-x" title="Delete from your boxels" onClick={() => setSure(true)}>
          Delete…
        </button>
      )}
    </Popover>
  );
}
