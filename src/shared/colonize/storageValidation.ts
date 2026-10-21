import type { BasketCheckoutBundle, BasketCheckoutResult } from "./types";
import type { WingMember } from "./wingManifest";
import type { ShoppingRunState } from "./types";

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

export function parseShoppingRun(raw: unknown): ShoppingRunState | null {
  if (!raw || typeof raw !== "object") return null;
  const j = raw as Partial<ShoppingRunState>;
  if (typeof j.createdAt !== "string" || !Array.isArray(j.items)) return null;
  const items = j.items.filter(
    (it) =>
      Boolean(it && typeof it === "object") &&
      typeof (it as { id?: unknown }).id === "string" &&
      typeof (it as { label?: unknown }).label === "string" &&
      typeof (it as { quantityNeeded?: unknown }).quantityNeeded === "number" &&
      typeof (it as { stopIndex?: unknown }).stopIndex === "number" &&
      typeof (it as { stationName?: unknown }).stationName === "string" &&
      typeof (it as { systemName?: unknown }).systemName === "string" &&
      typeof (it as { done?: unknown }).done === "boolean",
  );
  if (!items.length) return null;
  return { createdAt: j.createdAt, items };
}

export function parseSavedCheckout(raw: unknown): {
  savedAt: string;
  result: BasketCheckoutResult | null;
  bundle: BasketCheckoutBundle | null;
} | null {
  if (!raw || typeof raw !== "object") return null;
  const j = raw as Record<string, unknown>;
  if (typeof j.savedAt !== "string") return null;
  const result = j.result && typeof j.result === "object" ? (j.result as BasketCheckoutResult) : null;
  const bundle = j.bundle && typeof j.bundle === "object" ? (j.bundle as BasketCheckoutBundle) : null;
  if (!result && !bundle) return null;
  return { savedAt: j.savedAt, result, bundle };
}
