import type { BasketCheckoutBundle } from "./types";
import type { WingMember } from "./wingManifest";

export function parseWingMembers(raw: unknown): WingMember[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (m): m is WingMember =>
      Boolean(m && typeof m === "object") &&
      typeof (m as WingMember).id === "string" &&
      typeof (m as WingMember).name === "string" &&
      typeof (m as WingMember).color === "string" &&
      Array.isArray((m as WingMember).claims),
  );
}

/** The saved checkout's sellers; a `result` field older saves carry is ignored (it was always null in 1.3.0). */
export function parseSavedCheckout(raw: unknown): {
  savedAt: string;
  bundle: BasketCheckoutBundle | null;
} | null {
  if (!raw || typeof raw !== "object") return null;
  const j = raw as Record<string, unknown>;
  if (typeof j.savedAt !== "string") return null;
  const bundle = j.bundle && typeof j.bundle === "object" ? (j.bundle as BasketCheckoutBundle) : null;
  if (!bundle) return null;
  return { savedAt: j.savedAt, bundle };
}
