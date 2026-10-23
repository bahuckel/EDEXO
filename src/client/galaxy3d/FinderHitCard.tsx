/**
 * The map's card for a colonisation-candidate hit, apart from the drawer (discuss item 26): the side panel shows it
 * whether or not the drawer has loaded.
 */
import { FINDER_FILTERS, type FinderHit } from "@shared/finder";
import { STAR_CLASSES } from "@shared/galaxyTraits";
import { fmtLyAway } from "@shared/format";
import { CopySystemButton } from "../CopySystemButton";

/** The card's count labels. Out of the drawer's groups, a gas giant's label needs saying it is one ("Water-based life" alone reads oddly). */
const CARD_LABEL = new Map(
  FINDER_FILTERS.map((f) => [f.key as string, f.group === "Gas giants" && f.key !== "water_giant" ? `Gas giant, ${f.label}` : f.label]),
);
const starLabel = (k: string) => STAR_CLASSES.find((s) => s.key === k)?.label ?? k;

/** The map's card for a finder hit: every non-zero count, its stars and how complete the listing is. */
export function FinderHitCard({ h, ship }: { h: FinderHit; ship: { x: number; y: number; z: number } | null }) {
  const counts = Object.entries(h.counts).filter(([k, n]) => n > 0 && k !== "stars" && k !== "planets");
  const otherStars = h.starsPresent.filter((k) => k !== h.mainStar);
  const fromShip = ship ? Math.hypot(ship.x - h.x, ship.y - h.y, ship.z - h.z) : null;
  return (
    <div className="finder-card">
      <h2 className="g3d-panel__name">
        {h.name} <CopySystemButton system={h.name} />
      </h2>
      <p className="g3d-panel__meta">
        {fmtLyAway(h.distLy)} from {h.reference}
        {fromShip != null ? ` · ${fmtLyAway(fromShip)} from your ship` : ""}
      </p>
      <p>
        {h.counts.stars} star{h.counts.stars === 1 ? "" : "s"}, {h.counts.planets} planet{h.counts.planets === 1 ? "" : "s"}
        {h.bodyCount != null ? ` · ${h.listed} of ${h.bodyCount} bodies listed` : ` · ${h.listed} bodies listed`}
        {h.fullyScanned ? " (all of them)" : ""}
      </p>
      {h.mainStar || h.starsPresent.length ? (
        <p className="dim">
          {h.mainStar ? `Main star ${starLabel(h.mainStar)}` : ""}
          {otherStars.length ? `${h.mainStar ? "; also " : ""}${otherStars.map(starLabel).join(", ")}` : ""}
        </p>
      ) : null}
      {counts.length ? (
        <ul className="finder-card__counts">
          {counts.map(([k, n]) => (
            <li key={k}>
              <span>{CARD_LABEL.get(k) ?? k}</span> <b>{n}</b>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="dim tiny">
        {h.colonised ? "Colonised. " : h.claimed ? "Claimed. " : ""}From Spansh&apos;s dump: the bodies it lists, so there may be more.
      </p>
    </div>
  );
}
