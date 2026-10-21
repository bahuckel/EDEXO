import { primaryCheckoutReferenceSystem } from "../../../shared/colonize/plannerScan";
import type { ColonizeSnapshot, DepotSnapshot, ResourceRow } from "../../../shared/colonize/types";

export type BasketLine = { id: string; name: string; nameLocalised: string; quantityTons: number };

/**
 * Resolves a site's shopping hub. Supplied by the caller because the pins are React state
 * now, rather than a set of storage keys this module used to read at call time.
 */
export type DepotRefResolver = (d: DepotSnapshot) => string;

export function referenceSystemFromSnap(
  snap: ColonizeSnapshot | null,
  resolveDepotRef: DepotRefResolver,
): string {
  return primaryCheckoutReferenceSystem(snap, resolveDepotRef);
}

/** Populated by `npm run brand:sync` → `src/renderer/public/` (root PNGs optional). */
const assetUrl = (file: string) => `${import.meta.env.BASE_URL}${file}`;

export const iconUrl = assetUrl("app-icon.png");
export const HERO_IMAGE_URLS = [assetUrl("coriolis-build.png"), assetUrl("planetary-build.png")] as const;

export function formatPct(n: number | null): string {
  if (n == null || Number.isNaN(n)) return "—";
  return `${(n * 100).toFixed(1)}%`;
}

function isFullyDeliveredRow(r: ResourceRow): boolean {
  return r.required > 0 && r.provided >= r.required;
}

export function incompleteResources(resources: ResourceRow[]): ResourceRow[] {
  return resources.filter((r) => !isFullyDeliveredRow(r));
}

export function completeResources(resources: ResourceRow[]): ResourceRow[] {
  return resources.filter((r) => isFullyDeliveredRow(r));
}
