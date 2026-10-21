import { carrierTonsFor, type CarrierStock } from "../../../shared/colonize/carrierStock";

export type Availability = {
  /** Tons of this commodity in the ship's hold. */
  ship: number;
  /** Tons aboard each carrier the commander has switched on for hauling. */
  carriers: { carrierId: string; name: string; kind: string; tons: number }[];
  total: number;
};

/** What the commander has, split by where it is — the ship and each hauling carrier. */
export function availabilityFor(
  needId: string,
  shipTons: number,
  carriers: CarrierStock[],
): Availability {
  const rows = carrierTonsFor(carriers, needId);
  const total = rows.reduce((sum, r) => sum + r.tons, shipTons);
  return { ship: shipTons, carriers: rows, total };
}

/**
 * The one sentence that says where a commodity stands, for a `title`.
 *
 * Five numbers do not fit on a row, and the one that matters changes with what you are doing:
 * delivered while checking progress, still-needed while shopping, in-carrier while deciding
 * whether to fly the carrier over. So the row shows the short form and this says the rest.
 */
export function availabilityTitle(
  label: string,
  provided: number,
  required: number,
  a: Availability,
): string {
  const gap = Math.max(0, required - provided);
  const bits = [
    `${label}: ${provided.toLocaleString()} / ${required.toLocaleString()} t delivered`,
    a.ship > 0 ? `${a.ship.toLocaleString()} t in your hold` : null,
    ...a.carriers.map((c) => `${c.tons.toLocaleString()} t aboard ${c.name}`),
    gap > 0
      ? `${Math.max(0, gap - Math.min(gap, a.total)).toLocaleString()} t still to buy`
      : "nothing left to deliver",
  ];
  return bits.filter(Boolean).join(" · ");
}

/**
 * Why a buy card is asking for less than the site still needs.
 *
 * The tonnage on a buy card is already net of everything the commander owns, so showing the
 * carrier chips there without a word would read as "and this much more". It is the opposite:
 * these tons are the reason the number came down.
 */
export function carrierCreditTitle(label: string, quantityNeeded: number, a: Availability): string {
  if (!a.carriers.length) return "";
  const aboard = a.carriers.map((c) => `${c.tons.toLocaleString()} t aboard ${c.name}`).join(" · ");
  return `${label}: ${aboard} — already counted, so this asks for ${quantityNeeded.toLocaleString()} t`;
}
