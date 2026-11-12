/**
 * The small marks that were characters (review 2026-11-07 §9, plan 7.5): ▾ / ▸ for open and closed, ✓ for done.
 * Characters took the font's shape and size, which differed between fonts and sat off the text's middle; these are
 * lucide's, at the text's size, on its middle. Text in sentences ("EDSM ✓", the HUD's lines) keeps its characters.
 */
import { Check, ChevronDown, ChevronRight, X } from "lucide-react";

const ICON = { className: "ui-glyph", size: "1em", strokeWidth: 2.4, "aria-hidden": true } as const;

/** Open (down) or closed (right), before a folding section's label. */
export function Disclosure({ open }: { open: boolean }) {
  return open ? <ChevronDown {...ICON} /> : <ChevronRight {...ICON} />;
}

/** Done, logged, delivered. */
export function Done() {
  return <Check {...ICON} />;
}

/** Not done, where the pair ✓ / ✗ said both. */
export function NotDone() {
  return <X {...ICON} />;
}

/** A dropdown's caret. */
export function Caret() {
  return <ChevronDown {...ICON} />;
}
