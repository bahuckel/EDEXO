/**
 * What a list or panel says when it has nothing to show (review 2026-11-07 §9, plan 7.5): an icon, the sentence and,
 * when there is one, the action that fills it. Two tones: "empty" (nothing yet, nothing matches) and "error" (it
 * could not be read), so a failure no longer looks like an empty list. Loading keeps its spinner (ui/Loading).
 */
import type { ReactNode } from "react";
import { CircleAlert, Inbox } from "lucide-react";

export function EmptyState({
  children,
  tone = "empty",
  action,
}: {
  children: ReactNode;
  tone?: "empty" | "error";
  /** A button (or link) that fills the empty list, under the sentence. */
  action?: ReactNode;
}) {
  const Icon = tone === "error" ? CircleAlert : Inbox;
  return (
    <div className={`ui-empty ui-empty--${tone}`} role={tone === "error" ? "alert" : undefined}>
      <Icon className="ui-empty__icon" size={18} strokeWidth={1.8} aria-hidden="true" />
      <div className="ui-empty__body">
        <p className="ui-empty__text">{children}</p>
        {action ? <div className="ui-empty__action">{action}</div> : null}
      </div>
    </div>
  );
}
