/**
 * One material list in two densities (R5b, cards mockup P1): rows (name, tons left, a thin bar with what is aboard
 * striped after what is delivered) and tiles (Compare's fact tile with a bar at its foot). Open first, biggest first;
 * delivered last, in green (siteMaterials.ts orders them; the HUD and the phone use the same order).
 */
import { formatTons as tons } from "../../../shared/colonize/formatPrice";
import type { SiteMaterial } from "../../../shared/colonize/siteMaterials";

const pct = (n: number, of: number) => (of > 0 ? Math.max(0, Math.min(100, (n / of) * 100)) : 0);

/** The thin bar: delivered, then aboard striped after it. */
function MatBar({ m }: { m: SiteMaterial }) {
  const done = pct(m.provided, m.required);
  const aboard = pct(m.aboard, m.required);
  return (
    <span className="cz-mbar" aria-hidden="true">
      <i className="cz-mbar__fill" style={{ width: `${m.done ? 100 : done}%` }} />
      {aboard > 0 && !m.done ? <i className="cz-mbar__aboard" style={{ left: `${done}%`, width: `${Math.min(aboard, 100 - done)}%` }} /> : null}
    </span>
  );
}

export function MaterialRows({ rows, showOf = false, flipPrefix }: { rows: SiteMaterial[]; showOf?: boolean; flipPrefix?: string }) {
  return (
    <ul className="cz-mats">
      {rows.map((m) => (
        <li
          key={m.id || m.label}
          className={`cz-mat${m.done ? " cz-mat--done" : ""}`}
          data-flip-key={flipPrefix ? `${flipPrefix}:${m.id || m.label}` : undefined}
        >
          <span className="cz-mat__name" title={m.label}>
            {m.label}
          </span>
          {m.done ? (
            <span className="cz-mat__v">
              ✓ delivered <small>{tons(m.required)}</small>
            </span>
          ) : (
            <span className="cz-mat__v">
              <span className="cz-hi">{tons(m.left)}</span>
              {m.aboard > 0 ? <small className="cz-ok"> {m.aboard.toLocaleString("en-US")} aboard</small> : null}
              {showOf && !m.aboard ? <small className="cz-dim"> of {tons(m.required)}</small> : null}
            </span>
          )}
          <MatBar m={m} />
        </li>
      ))}
    </ul>
  );
}

export function MaterialTiles({ rows, flipPrefix }: { rows: SiteMaterial[]; flipPrefix?: string }) {
  return (
    <div className="cz-mtiles">
      {rows.map((m) => {
        const done = pct(m.provided, m.required);
        const aboard = pct(m.aboard, m.required);
        return (
          <div
            key={m.id || m.label}
            className={`fact cz-mtile${m.done ? " fact--tone-yours" : ""}`}
            data-flip-key={flipPrefix ? `${flipPrefix}:${m.id || m.label}` : undefined}
          >
            <span className="fact-k" title={m.label}>
              {m.label}
            </span>
            <span className="fact-v">{m.done ? "✓ delivered" : tons(m.left)}</span>
            <span className="cz-mtile__sub">
              {m.done ? tons(m.required) : m.aboard > 0 ? `${m.aboard.toLocaleString("en-US")} t aboard` : `of ${tons(m.required)}`}
            </span>
            <span className="cz-mtile__bar" aria-hidden="true">
              <i className="f" style={{ width: `${m.done ? 100 : done}%` }} />
              {aboard > 0 && !m.done ? <i className="a" style={{ left: `${done}%`, width: `${Math.min(aboard, 100 - done)}%` }} /> : null}
            </span>
          </div>
        );
      })}
    </div>
  );
}
