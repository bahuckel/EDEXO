/**
 * A panel hanging off a button (plan 3.3, 2026-10-12), on Radix Popover. What the hand-rolled ones
 * each did a part of: it opens beside its button and stays inside the window (Radix moves it back in;
 * this replaces `measurePopoverSide`), focus goes into it and back to the button on closing, and it
 * closes on Escape, a click outside, or focus leaving it. The button gets `aria-expanded`,
 * `aria-controls` and `aria-haspopup`; the panel is a `dialog` named by `label`.
 *
 * The trigger is the screen's own button (Radix `asChild`): it keeps its classes and must not toggle
 * the panel itself. The panel keeps its own classes; `tw:static` takes it out of the old
 * `position: absolute / fixed` rules, as Radix's wrapper does the placing.
 *
 * `portal` draws it at the end of <body> (a panel that already lived there, as the bookmark editor
 * did); otherwise it stays where it is in the page, inside the same clip and stacking as before.
 * `contained`: a click in the panel stops there (React passes a portal's clicks up to the row or card
 * the button sits in). Inside a dialog (useModal), Escape closes the panel first, not the dialog.
 *
 * `at` instead of `trigger`: a panel opened at a point (a click on a map or a strip), not by a button
 * of its own. It hangs off that point, and on closing focus goes back to what had it when it opened.
 */
import * as RP from "@radix-ui/react-popover";
import { useLayoutEffect, useMemo, useRef, type ReactElement, type ReactNode } from "react";

export function Popover({
  open,
  onOpenChange,
  trigger,
  at,
  label,
  className,
  portal = false,
  side = "bottom",
  align = "start",
  sideOffset = 6,
  alignOffset = 0,
  contained = false,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The button that opens it; one element. */
  trigger?: ReactElement;
  /** Or the point it opens at (viewport pixels), with no button of its own. */
  at?: { left: number; top: number };
  /** The panel's accessible name. */
  label: string;
  className?: string;
  portal?: boolean;
  /** Which side of the button (or point) first; it flips when there is no room. */
  side?: "top" | "bottom" | "left" | "right";
  /** Which edge of the button it lines up with first (`start` = grows to the right). */
  align?: "start" | "center" | "end";
  sideOffset?: number;
  /** Along the edge, from where `align` puts it. */
  alignOffset?: number;
  contained?: boolean;
  children: ReactNode;
}) {
  // A point as Radix's anchor: a rectangle of no size there.
  const point = useMemo(
    () =>
      at
        ? {
            current: {
              getBoundingClientRect: () => DOMRect.fromRect({ x: at.left, y: at.top, width: 0, height: 0 }),
            },
          }
        : null,
    [at?.left, at?.top], // eslint-disable-line react-hooks/exhaustive-deps
  );
  // No trigger to give focus back to: what had it when the panel opened.
  const opener = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (open && at) opener.current = document.activeElement as HTMLElement | null;
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const content = (
    <RP.Content
      className={className ? `${className} tw:static` : "tw:static"}
      aria-label={label}
      side={side}
      align={align}
      sideOffset={sideOffset}
      alignOffset={alignOffset}
      collisionPadding={8}
      onClick={contained ? (ev) => ev.stopPropagation() : undefined}
      onCloseAutoFocus={
        at
          ? (ev) => {
              ev.preventDefault();
              opener.current?.focus({ preventScroll: true });
            }
          : undefined
      }
    >
      {children}
    </RP.Content>
  );
  return (
    <RP.Root open={open} onOpenChange={onOpenChange}>
      {point ? <RP.Anchor virtualRef={point} /> : <RP.Trigger asChild>{trigger}</RP.Trigger>}
      {portal ? <RP.Portal>{content}</RP.Portal> : content}
    </RP.Root>
  );
}
