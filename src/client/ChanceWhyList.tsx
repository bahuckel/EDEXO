/**
 * The facts behind a candidate's chance (plan 1.7, 2026-10-11; built on the server by chanceWhy.ts): how
 * often the genus grows on bodies like this one, a measured rate where one applies, the fields that
 * set this species apart from the others of its genus on this body, and how often it has been logged in
 * the region. Each nudge is shown signed (+ for, − against); a plain fact has none.
 */
import type { SpeciesMatch } from "@shared/types";

type Line = NonNullable<SpeciesMatch["chanceWhy"]>[number];

const sign = (w: number) => (w > 0 ? `+${w.toFixed(1)}` : w.toFixed(1));

/** The lines as plain text, for a row's hover title. */
export function chanceWhyText(m: Pick<SpeciesMatch, "chanceWhy" | "entry">): string {
  const lines = m.chanceWhy ?? [];
  const out: string[] = ["Why this chance"];
  for (const l of lines.filter((x) => x.kind !== "field")) out.push(`${l.weight != null ? `${sign(l.weight)}  ` : "·  "}${l.label}`);
  const fields = lines.filter((x) => x.kind === "field");
  if (fields.length) {
    out.push(`Against the other ${m.entry.genus} here:`);
    for (const l of fields) out.push(`  ${sign(l.weight ?? 0)}  ${l.label}`);
  }
  return out.join("\n");
}

function Row({ l }: { l: Line }) {
  const cls = l.weight == null ? "" : l.weight > 0 ? " chance-why__w--up" : " chance-why__w--down";
  return (
    <li className="chance-why__line">
      <span className={`chance-why__w${cls}`}>{l.weight == null ? "·" : sign(l.weight)}</span>
      <span>{l.label}</span>
    </li>
  );
}

export function ChanceWhyList({ m }: { m: Pick<SpeciesMatch, "chanceWhy" | "entry"> }) {
  const lines = m.chanceWhy ?? [];
  if (!lines.length) return null;
  const facts = lines.filter((x) => x.kind !== "field");
  const fields = lines.filter((x) => x.kind === "field");
  return (
    <div className="chance-why">
      {facts.length ? (
        <ul className="chance-why__list">
          {facts.map((l, i) => (
            <Row key={i} l={l} />
          ))}
        </ul>
      ) : null}
      {fields.length ? (
        <>
          <p className="chance-why__head">Against the other {m.entry.genus} here</p>
          <ul className="chance-why__list">
            {fields.map((l, i) => (
              <Row key={i} l={l} />
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}
