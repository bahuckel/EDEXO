/**
 * A pop-up's head: its title, any tools, a "?" when there is an explanation, and the close ×, in that order on the
 * right (owner, 2026-10-23: the "i" next to Data value "moves to a [?] next to the X-close button inside of the
 * pop-up screen"; every pop-up with an explanation gets the same). The explanation opens under the head, like a
 * fold's help, and is not a tooltip: it can be read, scrolled and selected.
 */
import { useId, useState, type ReactNode } from "react";
import { HelpToggle } from "./Fold";

export function ModalHead({
  title,
  titleId,
  titleClassName,
  onClose,
  closeTitle,
  help,
  helpTitle,
  tools,
}: {
  title: ReactNode;
  /** Set when the dialog is named by this heading (aria-labelledby). */
  titleId?: string;
  /** Extra classes on the heading. */
  titleClassName?: string;
  onClose: () => void;
  closeTitle?: string;
  /** The explanation behind the "?"; none, no "?". */
  help?: ReactNode;
  /** The "?"'s tooltip. */
  helpTitle?: string;
  /** Buttons that belong in the head, left of the "?" (a snapshot button, a mode switch). */
  tools?: ReactNode;
}) {
  const [helpOpen, setHelpOpen] = useState(false);
  const helpId = useId();
  return (
    <>
      <div className="modal-head">
        <h3 id={titleId} className={titleClassName}>
          {title}
        </h3>
        {/* The × comes before the "?" in the page, so a pop-up still opens with the focus on its ×; CSS order shows
            the "?" left of it. */}
        <div className="modal-head__tools">
          {tools}
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close" title={closeTitle}>
            ×
          </button>
          {help ? (
            <HelpToggle
              open={helpOpen}
              onToggle={() => setHelpOpen((o) => !o)}
              title={helpTitle ?? "What this shows"}
              controls={helpId}
            />
          ) : null}
        </div>
      </div>
      {help && helpOpen ? (
        <div className="modal-help" id={helpId}>
          {help}
        </div>
      ) : null}
    </>
  );
}
