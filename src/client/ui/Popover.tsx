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
 */
import * as RP from "@radix-ui/react-popover";
import type { ReactElement, ReactNode } from "react";

export function Popover({
  open,
  onOpenChange,
  trigger,
  label,
  className,
  portal = false,
  align = "start",
  sideOffset = 6,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The button that opens it; one element. */
  trigger: ReactElement;
  /** The panel's accessible name. */
  label: string;
  className?: string;
  portal?: boolean;
  /** Which edge of the button it lines up with first (`start` = grows to the right). */
  align?: "start" | "center" | "end";
  sideOffset?: number;
  children: ReactNode;
}) {
  const content = (
    <RP.Content
      className={className ? `${className} tw:static` : "tw:static"}
      aria-label={label}
      side="bottom"
      align={align}
      sideOffset={sideOffset}
      collisionPadding={8}
    >
      {children}
    </RP.Content>
  );
  return (
    <RP.Root open={open} onOpenChange={onOpenChange}>
      <RP.Trigger asChild>{trigger}</RP.Trigger>
      {portal ? <RP.Portal>{content}</RP.Portal> : content}
    </RP.Root>
  );
}
