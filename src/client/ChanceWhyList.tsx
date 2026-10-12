/**
 * The facts behind a candidate's chance (plan 1.7, 2026-10-11; built on the server by chanceWhy.ts): how
 * often the genus grows on bodies like this one, a measured rate where one applies, the fields that
 * set this species apart from the others of its genus on this body, and how often it has been logged in
 * the region. Each nudge is shown signed (+ for, − against); a plain fact has none.
 */
import type { SpeciesMatch } from "@shared/types";

/*
  Styled with tw: utilities (plan 3.4, 2026-10-12); no stylesheet of its own. The class names stay as
  hooks for tests and the inspector. --good is not defined anywhere: its fallback is the colour shown.
*/
const LIST = "chance-why__list tw:m-0 tw:p-0 tw:list-none tw:grid tw:gap-[2px]";
const W = "tw:tabular-nums tw:text-right";

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
  const tone =
    l.weight == null
      ? "tw:text-text-dim"
      : l.weight > 0
        ? "chance-why__w--up tw:[color:var(--good,#6fd08c)]"
        : "chance-why__w--down tw:[color:var(--bad,#e07a6a)]";
  return (
    <li className="chance-why__line tw:grid tw:grid-cols-[2.6em_1fr] tw:gap-[6px] tw:text-text">
      <span className={`chance-why__w ${W} ${tone}`}>{l.weight == null ? "·" : sign(l.weight)}</span>
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
    <div className="chance-why tw:m-[4px_0_2px] tw:text-xs tw:text-left">
      {facts.length ? (
        <ul className={LIST}>
          {facts.map((l, i) => (
            <Row key={i} l={l} />
          ))}
        </ul>
      ) : null}
      {fields.length ? (
        <>
          <p className="chance-why__head tw:m-[6px_0_2px] tw:text-text-dim tw:tracking-[0.04em]">Against the other {m.entry.genus} here</p>
          <ul className={LIST}>
            {fields.map((l, i) => (
              <Row key={i} l={l} />
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}
