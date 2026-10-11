/**
 * A modal dialog (plan 3.3, 2026-10-12): the app's backdrop, panel and head, with useModal's behaviour
 * (focus moved in and kept in, Escape closes the top one only, focus given back, the page held still).
 * Render it only while open.
 *
 * Not Radix Dialog (owner's choice, 2026-10-12): useModal already does what it would, and the screens
 * draw into their tab panes, where a dialog portalled to <body> and a second scroll lock would not fit.
 * Unlike a screen using useModal directly, a Dialog stays modal inside a tab (`modalInTab`), and a
 * click anywhere in it or on its backdrop stops here, so it never reaches the card or list it opened from.
 */
import { useId, type ReactNode } from "react";
import { useModal } from "./useModal";

export function Dialog({
  title,
  onClose,
  className,
  backdropClassName,
  closeTitle,
  children,
}: {
  /** The heading; the dialog is named by it. */
  title: ReactNode;
  onClose: () => void;
  /** Extra classes on the panel (`modal-panel …`). */
  className?: string;
  /** Extra classes on the backdrop (`modal-backdrop …`). */
  backdropClassName?: string;
  /** The close button's tooltip. */
  closeTitle?: string;
  /** The body, usually a `modal-body`. */
  children: ReactNode;
}) {
  const ref = useModal<HTMLDivElement>(true, onClose, { modalInTab: true });
  const titleId = useId();
  return (
    <div
      className={backdropClassName ? `modal-backdrop ${backdropClassName}` : "modal-backdrop"}
      role="presentation"
      onClick={(ev) => {
        ev.stopPropagation();
        if (ev.target === ev.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        className={className ? `modal-panel ${className}` : "modal-panel"}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="modal-head">
          <h3 id={titleId}>{title}</h3>
          <button
            type="button"
            className="modal-close"
            onClick={onClose}
            aria-label="Close"
            title={closeTitle}
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
