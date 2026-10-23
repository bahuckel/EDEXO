/**
 * The Boxels table's columns (moved out of Boxel.tsx, audit 2026-10-22). BoxelScreen still memoises
 * them on the same three values as before, so the callbacks they capture are exactly as fresh as they
 * were.
 */
import type { BoxelTableRowDTO, SavedBoxelDTO } from "@shared/boxel";
import { CopySystemButton } from "../CopySystemButton";
import { Tooltip } from "../ui/Tooltip";
import type { Column } from "../ui/DataTable";
import { NOTABLE_SHORT } from "../boxelFilter";
import { fromIndex, NOTABLE_LABEL, OTHER_STARS_SHOWN } from "./boxelLabels";

export function boxelColumns({
  byId,
  order,
  flownMax,
  openRow,
  patch,
  setCutAsk,
}: {
  byId: Map<string, SavedBoxelDTO>;
  order: Map<string, number>;
  flownMax: Map<string, number>;
  openRow: (r: BoxelTableRowDTO) => void;
  patch: (id: string, body: Record<string, unknown>) => Promise<unknown>;
  setCutAsk: (ask: { id: string; n: number }) => void;
}): Column<BoxelTableRowDTO>[] {
  return [
    {
      key: "n",
      label: "#",
      numeric: true,
      title: "The system's number in its boxel (rows of several boxels stay grouped by boxel)",
      value: (r) => (order.get(r.boxelId) ?? 0) * 1e5 + r.n,
      render: (r) => <span className="dim">{r.n}</span>,
    },
    {
      key: "sys",
      label: "System",
      value: (r) => r.name,
      render: (r) => (
        <span className="boxel-sys">
          {r.name}
          <CopySystemButton system={r.name} />
        </span>
      ),
    },
    {
      key: "flown",
      label: "Flown",
      title: "Flown (when you were last there), skipped, or not yet",
      value: (r) => (r.flown ? `2${r.visitedAt ?? ""}` : r.skipped ? "1" : null),
      render: (r) =>
        r.flown ? (
          <span
            className="fdb-dss"
            title={r.visitedAt ? `Last there ${r.visitedAt.slice(0, 16).replace("T", " ")}` : undefined}
          >
            ✓ {r.visitedAt ? r.visitedAt.slice(0, 10) : "flown"}
          </span>
        ) : r.skipped ? (
          <span className="boxel-skipped">skipped</span>
        ) : r.onRoute ? (
          <span
            className="dim"
            title="Not flown yet: a route you plotted passes through it, or you targeted it in the galaxy map, so it exists"
          >
            on route
          </span>
        ) : r.gap ? (
          <span
            className="dim"
            title="Not recorded anywhere, but a higher system of this boxel is known: systems are numbered without gaps (mass codes a–g), so it exists"
          >
            exists
          </span>
        ) : (
          <span className="dim">—</span>
        ),
    },
    {
      key: "main",
      label: "Main star",
      title:
        "Flown: the arrival star as you scanned it. Not flown: its class in the galaxy index (no luminosity)",
      value: (r) => r.mainStar,
      render: (r) =>
        r.notOnSpansh && !r.from ? (
          <span
            className="dim"
            title="Looked up: Spansh has no record of it — undiscovered, as far as anyone uploaded"
          >
            not on Spansh
          </span>
        ) : (
          fromIndex(r, r.mainStar ?? "—")
        ),
    },
    {
      key: "stars",
      label: "Other stars",
      value: (r) => (r.from ? r.otherStars.length : null),
      // Two, then "+3 more" with the rest on hover (owner, 2026-10-05: the field had no limit).
      render: (r) =>
        r.otherStars.length ? (
          <span className="boxel-stars">
            {fromIndex(r, r.otherStars.slice(0, OTHER_STARS_SHOWN).join(", "))}
            {r.otherStars.length > OTHER_STARS_SHOWN ? (
              <Tooltip
                text={r.otherStars.slice(OTHER_STARS_SHOWN).join(", ")}
                className="boxel-stars__more"
              >
                <span tabIndex={0}>+{r.otherStars.length - OTHER_STARS_SHOWN} more</span>
              </Tooltip>
            ) : null}
          </span>
        ) : (
          <span className="dim">—</span>
        ),
    },
    {
      key: "bodies",
      label: "Bodies",
      numeric: true,
      title:
        "Flown: bodies you scanned, of the count the FSS gave. Not flown: the bodies the galaxy index knows",
      value: (r) => r.bodies?.total ?? r.bodies?.scanned ?? null,
      render: (r) =>
        !r.bodies ? (
          <span className="dim">—</span>
        ) : r.bodies.scanned == null ? (
          fromIndex(r, String(r.bodies.total ?? "—"))
        ) : (
          <span
            className={r.bodies.total != null && r.bodies.scanned >= r.bodies.total ? "fdb-dss" : undefined}
          >
            {r.bodies.scanned}
            {r.bodies.total != null ? `/${r.bodies.total}` : ""}
          </span>
        ),
    },
    {
      key: "notable",
      label: "Notable",
      title:
        "Earth-like, water and ammonia worlds, other terraformables, Helium gas giants (the exact class) and green gas giants. Green and Helium gas giants only from your journals: the galaxy index has no gas giants of those classes",
      value: (r) => (r.notables.length ? r.notables.reduce((t, x) => t + (x.n ?? 1), 0) : null),
      render: (r) =>
        r.notables.length ? (
          <span
            className={`boxel-notables${r.from === "index" || r.from === "lookup" ? " boxel-from-index" : ""}`}
          >
            {r.notables.map((x) => (
              <span key={x.kind} className="boxel-notable" title={NOTABLE_LABEL[x.kind]}>
                {NOTABLE_SHORT[x.kind]}
                {x.n != null && x.n > 1 ? ` ×${x.n}` : ""}
              </span>
            ))}
          </span>
        ) : (
          <span className="dim">—</span>
        ),
    },
    {
      key: "bio",
      label: "Biology",
      title:
        "Flown: biology signals you saw and the species you logged, with what EDSM and Spansh recorded. Not flown: the galaxy index's records",
      value: (r) => (r.bio ? r.bio.species.length * 1000 + (r.bio.signals ?? (r.bio.seen ? 1 : 0)) : null),
      render: (r) => {
        if (!r.bio) return <span className="dim">—</span>;
        const signals = r.bio.signals ? `${r.bio.signals} signal${r.bio.signals === 1 ? "" : "s"}` : "";
        if (r.bio.species.length)
          return (
            <span className="boxel-bio">
              {signals ? <span className="dim">{signals}: </span> : null}
              {r.bio.species.join(", ")}
            </span>
          );
        return (
          <span className="dim">
            {signals || (r.bio.seen ? "signals, species not logged" : "none recorded")}
          </span>
        );
      },
    },
    {
      key: "act",
      label: "",
      value: () => null,
      render: (r) => {
        const b = byId.get(r.boxelId);
        return (
          <span className="boxel-row__actions">
            <button
              type="button"
              className="fdb-chip"
              title={
                r.flown
                  ? "Open it in EDEXO, from your journals"
                  : "Look it up on Spansh and open it in EDEXO"
              }
              onClick={() => openRow(r)}
            >
              {r.flown ? "Open" : "Spansh"}
            </button>
            {b && !r.flown ? (
              <button
                type="button"
                className={`fdb-chip${r.skipped ? " fdb-chip--on" : ""}`}
                aria-pressed={r.skipped}
                title="Skipped: not flown, but it counts as done for this boxel"
                onClick={() => void patch(b.id, { skip: r.n, on: !r.skipped })}
              >
                {r.skipped ? "Unskip" : "Skip"}
              </button>
            ) : null}
            {b && r.n >= 1 && r.n > (flownMax.get(b.id) ?? -1) ? (
              <button
                type="button"
                className="fdb-chip boxel-x"
                aria-label={`Delete -${r.n} and every system after it`}
                title="Delete this system and every one after it (a last number typed too high)"
                onClick={() => setCutAsk({ id: b.id, n: r.n })}
              >
                ×
              </button>
            ) : null}
          </span>
        );
      },
    },
  ];
}
