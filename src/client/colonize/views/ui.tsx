/**
 * Colonize on Compare's parts (1.3.0, C4; owner 2026-10-22: "the same quality and feel"): every section is Compare's
 * fold panel (chevron, uppercase title, the "?" drawer, folded state remembered), every number box is Compare's fact
 * tile, every button one of Compare's. Only the layout is Colonize's own (colonize.css).
 */
import type { ReactNode } from "react";
import { FoldPanel } from "../../ui/Fold";

/** Compare's buttons: the framed one, the filled "go", and the small text action (Compare's "Copy"). */
export const BTN = "btn-top-neutral";
export const BTN_GO = "btn-confirm-go";
export const BTN_WARN = "btn-top-neutral cz-btn--warn";
export const BTN_BAD = "btn-top-neutral cz-btn--bad";
export const BTN_LINK = "cz-link";

/**
 * A section: Compare's fold panel with a real heading. `tone` "hot" is what to do now (the next trip, buy here),
 * "info" is done or reported (Compare's blue).
 */
export function Panel({
  k,
  title,
  summary,
  aside,
  help,
  tone,
  className,
  heading = "h2",
  children,
}: {
  /** Remembered fold state, under `cz-<k>`. */
  k: string;
  title: ReactNode;
  summary?: ReactNode;
  aside?: ReactNode;
  help?: ReactNode;
  tone?: "hot" | "info";
  className?: string;
  heading?: "h2" | "h3";
  children: ReactNode;
}) {
  return (
    <FoldPanel
      foldKey={`cz-${k}`}
      heading={heading}
      title={title}
      summary={summary}
      aside={aside}
      help={help}
      className={["cz-panel", tone ? `cz-panel--${tone}` : "", className ?? ""].filter(Boolean).join(" ")}
    >
      {children}
    </FoldPanel>
  );
}

/** Puts text on the clipboard (Trips and Search had a copy each); never throws. */
export async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    /* no clipboard in this browser (or not over plain http): the text is on screen to copy by hand */
  }
}

/** Compare's fact tile: a small uppercase label over a value. */
export function Fact({ k, v, tone }: { k: ReactNode; v: ReactNode; tone?: "open" | "hot" }) {
  return (
    <div className={`fact${tone === "open" ? " fact--tone-open" : tone === "hot" ? " cz-fact--hot" : ""}`}>
      <span className="fact-k">{k}</span>
      <span className="fact-v">{v}</span>
    </div>
  );
}
