/**
 * Credits per tonne, as the game writes them: grouped thousands, no decimals.
 *
 * Defined once because two components had identical private copies, and a third formatted
 * prices inline with different rounding — so the same number could read differently
 * depending on which panel showed it.
 */
export function formatPrice(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

/**
 * Tons, whole and grouped the English way ("1,234 t"), in every Colonize view and the HUD. Seven panels each had their
 * own copy (audit 2026-10-22). Whether prices should follow the same locale is the owner's call; formatPrice above
 * still uses the system's.
 */
export function formatTons(n: number): string {
  return `${Math.round(n).toLocaleString("en-US")} t`;
}

/** An error's message for a note on screen: what was thrown, whatever it was. */
export function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
