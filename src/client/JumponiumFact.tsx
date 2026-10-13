/**
 * The Planetary body card's Jumponium field (1.2.16): the FSD injection materials in this body's crust, the rich ones
 * (top tenth of landable bodies) marked, and on hover each one's percent against what is aboard and what each
 * injection still lacks. Nothing shows for a body without a materials list (a detailed scan gives it).
 */
import { bodyJumponium, hitLabel, jumpElement, type JumponiumDTO } from "@shared/jumponium";
import { Tooltip } from "./ui/Tooltip";

export function JumponiumFact({
  materials,
  stock,
}: {
  materials: unknown;
  stock: JumponiumDTO | null | undefined;
}) {
  const bj = bodyJumponium(materials);
  if (!bj) return null;
  const rich = bj.hits.filter((h) => h.good);
  const shown = (rich.length ? rich : bj.hits.filter((h) => h.key !== "carbon")).slice(0, 3);
  const have = (k: string) => stock?.stock.find((s) => s.key === k);
  const pop = (
    <div className="volc-pop">
      <div className="volc-pop__head">FSD injection materials here</div>
      <ul className="volc-pop__list">
        {bj.hits.map((h) => {
          const s = have(h.key);
          return (
            <li key={h.key} className={`volc-pop__row${h.good ? " jump-pop__row--rich" : ""}`}>
              <span>
                {jumpElement(h.key).label} {hitLabel(h).split(" ").slice(1).join(" ")}
                {h.good ? " · rich" : ""}
              </span>
              <span className="volc-pop__status">
                {stock?.known && s ? `aboard ${s.count} / ${s.cap}` : ""}
              </span>
            </li>
          );
        })}
      </ul>
      {stock?.known ? (
        <p className="volc-pop__note">
          {stock.tiers
            .map(
              (t) =>
                `${t.name} (+${t.bonusPct} %): ${t.count}${t.short.length ? `, next needs ${t.short.map((x) => `${x.symbol} ${x.need}`).join(" ")}` : ""}`,
            )
            .join(" · ")}
        </p>
      ) : (
        <p className="volc-pop__note">
          What you hold is known after your next login (the game writes it then).
        </p>
      )}
      <p className="volc-pop__note">Rich: in the top tenth of landable bodies for that element.</p>
    </div>
  );
  return (
    <Tooltip text={pop} className="fact">
      <span className="fact-k">Jumponium</span>
      <span className="fact-v">
        {shown.length ? shown.map(hitLabel).join(" · ") : "carbon only"}
        {rich.length ? " ★" : ""}
      </span>
    </Tooltip>
  );
}
