/**
 * Does the body report volcanism? One answer for every reader (code review 2026-10-10, normalisers;
 * plan 1.1, 2026-10-11).
 *
 * The journal writes an empty string for a quiet body, EDSM and the Spansh dump write "No volcanism".
 * The question was answered ten ways (`includes("no volcanism")`, `!startsWith("no ")`, `=== "none"`,
 * ...), and they disagreed on spellings that do not occur today ("None", "no"), which is how one of
 * them would one day call a quiet body volcanic. Every spelling of "none" is quiet here.
 */
export function reportsVolcanism(raw: string | null | undefined): boolean {
  const v = String(raw ?? "").trim().toLowerCase();
  if (!v) return false;
  if (v === "none" || v === "no" || v.includes("no volcanism")) return false;
  return true;
}
