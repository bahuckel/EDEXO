/** Journal `ConstructionProgress` is 0–1; clamp and accept legacy 0–100 values. */
export function normalizeConstructionProgress(raw: number): number {
  if (!Number.isFinite(raw)) return 0;
  if (raw > 1.0001 && raw <= 100) return Math.min(1, raw / 100);
  return Math.min(1, Math.max(0, raw));
}
