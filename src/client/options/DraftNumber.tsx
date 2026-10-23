/**
 * A number field that saves only a whole number (moved out of OptionsPanels.tsx, audit 2026-10-22).
 */
import { useState } from "react";

/**
 * A number typed in full before it is saved (review 1.2.16): saved on Enter or when the field is left, only when it is
 * a number, so "50" is not saved as "5" and an emptied field does not jump to the minimum mid-edit.
 */
export function DraftNumber({
  value,
  min,
  max,
  onCommit,
  disabled,
  id,
  className,
  ariaLabel,
}: {
  value: number;
  min: number;
  max: number;
  onCommit: (v: number) => void;
  disabled?: boolean;
  id?: string;
  className?: string;
  ariaLabel?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft == null) return;
    const n = Number(draft);
    setDraft(null);
    if (draft.trim() !== "" && Number.isFinite(n) && n !== value) onCommit(Math.min(max, Math.max(min, Math.round(n))));
  };
  return (
    <input
      id={id}
      type="number"
      className={className}
      min={min}
      max={max}
      value={draft ?? String(value)}
      disabled={disabled}
      aria-label={ariaLabel}
      onChange={(ev) => setDraft(ev.target.value)}
      onBlur={commit}
      onKeyDown={(ev) => {
        if (ev.key === "Enter") commit();
        if (ev.key === "Escape") setDraft(null);
      }}
    />
  );
}
