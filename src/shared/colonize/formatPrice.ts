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
