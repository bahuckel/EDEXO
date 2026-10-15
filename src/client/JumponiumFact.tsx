/**
 * The Planetary body card's Laboratory field (1.2.16; "Mats", symbols only since 1.2.17): the FSD injection and AFM
 * refill materials in this body's crust, the rich ones (top tenth of landable bodies) marked, and on hover each one's percent against what is aboard
 * and what each recipe still lacks. Common elements (carbon, nickel, chromium, manganese) are left out. Nothing shows
 * for a body without a materials list (a detailed scan gives it).
 */
import {
  bodyJumponium,
  elementsOf,
  hitLabel,
  jumpElement,
  type JumpElement,
  type JumponiumDTO,
} from "@shared/jumponium";

const FSD_ELS = new Set(elementsOf("fsd"));
const AFM_ELS = new Set(elementsOf("afm"));
import { Tooltip } from "./ui/Tooltip";

export function JumponiumFact({
  materials,
  stock,
}: {
  materials: unknown;
  stock: JumponiumDTO | null | undefined;
}) {
  const bj = bodyJumponium(materials);
  const hits = (bj?.hits ?? []).filter((h) => !jumpElement(h.key).common);
  if (!hits.length) return null;
  const rich = hits.filter((h) => h.good);
  // Symbols only on the card (owner, 2026-10-15: "a lot of them are cut out ... just the periodic table/abbreviations
  // no percentages"); the percentages stay in the hover panel.
  const shown = (rich.length ? rich : hits).slice(0, 6);
  const have = (k: string) => stock?.stock.find((s) => s.key === k);
  const makes = (k: JumpElement) =>
    [FSD_ELS.has(k) ? "FSD" : "", AFM_ELS.has(k) ? "AFM" : ""].filter(Boolean).join(" / ");
  const tierLine = (label: string, tiers: JumponiumDTO["tiers"]) =>
    `${label}: ${tiers
      .map(
        (t) =>
          `${t.name} ${t.count}${t.short.length ? ` (next needs ${t.short.map((x) => `${x.symbol} ${x.need}`).join(" ")})` : ""}`,
      )
      .join(" · ")}`;
  const pop = (
    <div className="volc-pop">
      <div className="volc-pop__head">Laboratory materials here</div>
      <ul className="volc-pop__list">
        {hits.map((h) => {
          const s = have(h.key);
          return (
            <li key={h.key} className={`volc-pop__row${h.good ? " jump-pop__row--rich" : ""}`}>
              <span>
                {jumpElement(h.key).label} {hitLabel(h).split(" ").slice(1).join(" ")}
                {h.good ? " · rich" : ""} <span className="dim">{makes(h.key)}</span>
              </span>
              <span className="volc-pop__status">
                {stock?.known && s ? `aboard ${s.count} / ${s.cap}` : ""}
              </span>
            </li>
          );
        })}
      </ul>
      {stock?.known ? (
        <>
          <p className="volc-pop__note">{tierLine("FSD injections", stock.tiers)}</p>
          <p className="volc-pop__note">{tierLine("AFM refills", stock.afmTiers ?? [])}</p>
        </>
      ) : (
        <p className="volc-pop__note">
          What you hold is known after your next login (the game writes it then).
        </p>
      )}
      <p className="volc-pop__note">
        Rich: in the top tenth of landable bodies for that element. Carbon, nickel, chromium and manganese are
        on most bodies and left out.
      </p>
    </div>
  );
  return (
    <Tooltip text={pop} className="fact">
      <span className="fact-k">Mats</span>
      <span className="fact-v">
        {shown.map((h) => jumpElement(h.key).symbol).join(" ")}
        {rich.length ? " ★" : ""}
      </span>
    </Tooltip>
  );
}
