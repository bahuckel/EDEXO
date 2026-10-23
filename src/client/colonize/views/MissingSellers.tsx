/**
 * Materials the plan cannot buy yet, as tiles (R5b, cards mockup P7; discuss item 15): the tons, a reason chip (the
 * sentence on hover), "Ask Spansh" as a button and the two other ways (saved sellers further out, Inara in the EDEXO
 * Browser) in one small menu. Was a yellow banner with a sentence and three buttons per material.
 */
import { useState } from "react";
import { Popover } from "../../ui/Popover";
import { formatTons } from "../../../shared/colonize/formatPrice";
import { inaraCommoditySearchUrl } from "../../../shared/colonize/inaraLinks";
import { openInEdexoBrowser } from "../inaraBrowser";
import { BTN_WARN, Panel } from "./ui";

export type MissingItem = { id: string; label: string; quantityTons: number; why: "none" | "filtered" };

const WHY: Record<MissingItem["why"], { chip: string; text: string }> = {
  none: { chip: "None nearby", text: "No seller known nearby." },
  filtered: { chip: "Filtered out", text: "Sellers are known, but none fits what the plan may use (pad, distance, planet ports)." },
};

function FindMore({ item, near, busy, onSaved }: { item: MissingItem; near: string; busy: boolean; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      label={`More ways to find ${item.label}`}
      className="cz-findmenu"
      portal
      align="end"
      trigger={
        <button type="button" className={`${BTN_WARN} cz-btn--sm`} aria-label={`More ways to find ${item.label}`}>
          More ▾
        </button>
      }
    >
      <ul className="cz-findmenu__list">
        <li>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setOpen(false);
              onSaved();
            }}
          >
            Saved sellers<small>look further out</small>
          </button>
        </li>
        <li>
          <a
            href={inaraCommoditySearchUrl(item.label, near)}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => {
              setOpen(false);
              if (openInEdexoBrowser(e.currentTarget.href)) e.preventDefault();
            }}
          >
            Inara ↗<small>in the EDEXO Browser; its pop-up reads the sellers in</small>
          </a>
        </li>
      </ul>
    </Popover>
  );
}

export function MissingSellers({
  items,
  near,
  askingId,
  localId,
  onAsk,
  onSaved,
}: {
  items: MissingItem[];
  /** Where Spansh and Inara are asked from (the first site's hub). */
  near: string;
  askingId: string | null;
  localId: string | null;
  onAsk: (item: MissingItem) => void;
  onSaved: (item: MissingItem) => void;
}) {
  if (!items.length) return null;
  const total = items.reduce((a, i) => a + i.quantityTons, 0);
  return (
    <Panel
      k="no-seller"
      title={`No seller (${items.length})`}
      className="cz-panel--warn"
      aside={<span className="cz-aside-note">{formatTons(total)} the plan cannot buy yet</span>}
    >
      <div className="cz-misstiles">
        {items.map((item) => {
          const why = WHY[item.why];
          const asking = askingId === item.id;
          return (
            <div key={`${item.why}-${item.id}`} className="cz-misstile">
              <div className="fact">
                <span className="fact-k" title={item.label}>
                  {item.label}
                </span>
                <span className="fact-v">{formatTons(item.quantityTons)}</span>
                <span className="cz-chiprow">
                  <span className="sys-chip sys-chip--warn" title={why.text}>
                    {why.chip}
                  </span>
                </span>
                {asking ? (
                  <span className="cz-xs cz-warn">Asking Spansh…</span>
                ) : localId === item.id ? (
                  <span className="cz-xs cz-warn">Looking through saved sellers…</span>
                ) : (
                  <span className="cz-misstile__acts">
                    <button type="button" className={`${BTN_WARN} cz-btn--sm`} title={`Ask Spansh for sellers near ${near}`} onClick={() => onAsk(item)}>
                      Ask Spansh
                    </button>
                    <FindMore item={item} near={near} busy={localId != null} onSaved={() => onSaved(item)} />
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}
