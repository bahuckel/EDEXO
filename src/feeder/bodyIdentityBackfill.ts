/**
 * Phase 1 of INCLUDE-BODY-IDS: recover stable body identity from the archives already on disk.
 *
 * No network. Every field this needs was written during hydration and is still there — the packed
 * sample records carry the full EDSM body record, so `targetBody.id`, `targetBody.bodyId`, the body
 * name, the system name and EDSM's system id are all recoverable for all 39,088 sightings.
 *
 * `id64` is **not** recovered here. It was rounded by `JSON.parse` before it ever reached the disk
 * (see `bigIntJson.ts`), so the digits are gone from the archives too, and re-collecting them is
 * Phase 2's job against a live endpoint. This pass fills only the identifiers that survived intact:
 * the in-system BodyID, EDSM's body id, and EDSM's system id — all small integers, all well inside
 * float64.
 *
 * The deliverable is a **number**, not a migration. The corpus has always de-duplicated bodies by
 * normalised name; this measures what that cost. Two failure modes, and they are opposites:
 *
 *   - **Split** — one physical body under two names, so two rows resolve to one `(system, bodyId)`.
 *     The corpus double-counts it.
 *   - **Collision** — one name resolving to two different BodyIDs. The corpus has merged two bodies
 *     into one row and their conditions are averaged together.
 *
 * Both are reported and neither is repaired here. Merging rows changes the sighting counts every
 * profile is built from, and that is not a decision to take on the corpus's behalf.
 */
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { rawPlanetsDir } from "./paths.js";
import { readPackedSamples } from "./samplePacks.js";
import { toId64String } from "./bigIntJson.js";
import type { FeederStore } from "./feederDb.js";

/** Identity as one archive record reports it. Mirrors `normSystem`/`normBody` in `feederDb.ts`. */
function norm(s: string): string {
  return s.trim().toLowerCase();
}

export interface ArchiveIdentity {
  /** In-system BodyID — the journal's `BodyID`, and half of the join key. */
  bodyId: number | null;
  /** EDSM's own small integer body id. Safe as a number; the natural key for talking to EDSM. */
  edsmId: number | null;
  /** EDSM's small integer system id, from the hydration context. */
  systemEdsmId: number | null;
  /** The body name as EDSM rendered it, kept so a disagreement can be shown rather than guessed. */
  bodyName: string;
  /** Every distinct BodyID seen under this name — more than one means a name collision. */
  bodyIds: Set<number>;
}

export interface BackfillReport {
  archivesRead: number;
  recordsRead: number;
  /** Records whose body record carried no usable BodyID — nothing to backfill from. */
  recordsWithoutBodyId: number;
  /** Distinct `(system, body)` names the archives describe. */
  archiveBodies: number;
  /** Planet rows in the store, and how many the archives could name. */
  planetRows: number;
  planetsMatched: number;
  planetsUnmatched: number;
  /** Rows actually written; zero on a dry run. */
  planetsWritten: number;
  systemsWritten: number;
  /** One name, two BodyIDs — two physical bodies merged into one corpus row. */
  nameCollisions: { system: string; body: string; bodyIds: number[] }[];
  /** Two names, one BodyID — one physical body counted twice. */
  identitySplits: { system: string; bodyId: number; bodies: string[] }[];
  /** id64 values in the archives, and how many are beyond 2^53 and therefore already damaged. */
  id64Seen: number;
  id64Damaged: number;
  coverage: ReturnType<FeederStore["identityCoverage"]>;
  elapsedMs: number;
}

const MAX_SAFE = 9007199254740991;

interface TargetBodyShape {
  id?: unknown;
  id64?: unknown;
  bodyId?: unknown;
  name?: unknown;
}

function asSmallInt(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) return null;
  return value;
}

/**
 * Read every archive and index the identity it holds by `(normSystem, normBody)`.
 *
 * Exported so a caller can measure the archives without touching the store.
 */
export async function readArchiveIdentity(): Promise<{
  byName: Map<string, ArchiveIdentity>;
  archivesRead: number;
  recordsRead: number;
  recordsWithoutBodyId: number;
  id64Seen: number;
  id64Damaged: number;
}> {
  const byName = new Map<string, ArchiveIdentity>();
  let archivesRead = 0;
  let recordsRead = 0;
  let recordsWithoutBodyId = 0;
  let id64Seen = 0;
  let id64Damaged = 0;

  let speciesDirs: string[];
  try {
    speciesDirs = (await readdir(rawPlanetsDir(), { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
  } catch {
    return { byName, archivesRead, recordsRead, recordsWithoutBodyId, id64Seen, id64Damaged };
  }

  for (const slug of speciesDirs) {
    const records = await readPackedSamples(join(rawPlanetsDir(), slug));
    if (records.size === 0) continue;
    archivesRead += 1;
    for (const rec of records.values()) {
      recordsRead += 1;
      const ctx = rec.context as { systemId?: unknown; targetBody?: TargetBodyShape } | undefined;
      const target = ctx?.targetBody;
      const systemName = rec.systemName ?? "";
      const bodyName = rec.bodyName ?? (typeof target?.name === "string" ? target.name : "");
      if (!systemName || !bodyName) continue;

      // Count the damage while we are here — it is the evidence for Phase 2 being necessary at all.
      if (target?.id64 !== undefined && target.id64 !== null) {
        id64Seen += 1;
        const digits = toId64String(target.id64);
        if (digits && Math.abs(Number(digits)) > MAX_SAFE) id64Damaged += 1;
      }

      const bodyId = asSmallInt(target?.bodyId);
      if (bodyId === null) recordsWithoutBodyId += 1;

      const key = `${norm(systemName)}\0${norm(bodyName)}`;
      const existing = byName.get(key);
      if (existing) {
        if (bodyId !== null) {
          existing.bodyIds.add(bodyId);
          existing.bodyId ??= bodyId;
        }
        existing.edsmId ??= asSmallInt(target?.id);
        existing.systemEdsmId ??= asSmallInt(ctx?.systemId);
      } else {
        byName.set(key, {
          bodyId,
          edsmId: asSmallInt(target?.id),
          systemEdsmId: asSmallInt(ctx?.systemId),
          bodyName,
          bodyIds: bodyId === null ? new Set() : new Set([bodyId]),
        });
      }
    }
  }
  return { byName, archivesRead, recordsRead, recordsWithoutBodyId, id64Seen, id64Damaged };
}

/**
 * Backfill identity onto the store's planet and system rows.
 *
 * `apply: false` measures without writing, which is the default the CLI uses — the point of Phase 1
 * is the report, and the owner sees it before anything changes.
 */
export async function backfillBodyIdentity(
  store: FeederStore,
  opts: { apply: boolean },
): Promise<BackfillReport> {
  const started = Date.now();
  const { byName, archivesRead, recordsRead, recordsWithoutBodyId, id64Seen, id64Damaged } =
    await readArchiveIdentity();

  const planetRows = store.planetIdentityRows();
  const updates: { planetId: number; bodyId: number | null; edsmId: number | null }[] = [];
  const systemUpdates = new Map<string, number>();
  const nameCollisions: BackfillReport["nameCollisions"] = [];
  // Two corpus rows resolving to one physical body, gathered as we match rather than re-queried, so
  // the split is visible even on a dry run where nothing was written for SQL to group.
  const seenIdentity = new Map<string, { system: string; bodyId: number; bodies: string[] }>();
  let matched = 0;

  for (const row of planetRows) {
    const found = byName.get(`${row.normSystem}\0${row.normBody}`);
    if (!found) continue;
    matched += 1;

    if (found.bodyIds.size > 1) {
      nameCollisions.push({
        system: row.normSystem,
        body: row.displayBody,
        bodyIds: [...found.bodyIds].sort((a, b) => a - b),
      });
    }
    if (found.bodyId !== null) {
      const key = `${row.systemId}\0${found.bodyId}`;
      const group = seenIdentity.get(key);
      if (group) group.bodies.push(row.displayBody);
      else seenIdentity.set(key, { system: row.normSystem, bodyId: found.bodyId, bodies: [row.displayBody] });
    }

    // Only queue a row the archives can actually improve. Without the second half of each test, the
    // 157 bodies EDSM has no record of would be re-written with NULL on every run, and SQLite counts
    // a no-op UPDATE as a modified row — so the report would claim work it did not do.
    const gainsBodyId = row.bodyId === null && found.bodyId !== null;
    const gainsEdsmId = row.edsmId === null && found.edsmId !== null;
    if (gainsBodyId || gainsEdsmId) {
      updates.push({ planetId: row.planetId, bodyId: found.bodyId, edsmId: found.edsmId });
    }
    if (row.systemEdsmId === null && found.systemEdsmId !== null) {
      systemUpdates.set(row.normSystem, found.systemEdsmId);
    }
  }

  const identitySplits = [...seenIdentity.values()].filter((g) => g.bodies.length > 1);

  let planetsWritten = 0;
  let systemsWritten = 0;
  if (opts.apply) {
    // One save for both (feederDb.ts holdWrites).
    store.holdWrites(() => {
      planetsWritten = store.setBodyIdentity(updates);
      systemsWritten = store.setSystemEdsmIds(
        [...systemUpdates].map(([normSystem, edsmId]) => ({ normSystem, edsmId })),
      );
    });
  }

  return {
    archivesRead,
    recordsRead,
    recordsWithoutBodyId,
    archiveBodies: byName.size,
    planetRows: planetRows.length,
    planetsMatched: matched,
    planetsUnmatched: planetRows.length - matched,
    planetsWritten,
    systemsWritten,
    nameCollisions,
    identitySplits,
    id64Seen,
    id64Damaged,
    coverage: store.identityCoverage(),
    elapsedMs: Date.now() - started,
  };
}

const pct = (n: number, d: number) => (d === 0 ? "0.0" : ((n / d) * 100).toFixed(1));

export function formatBackfillReport(r: BackfillReport, applied: boolean): string {
  const out: string[] = [];
  out.push(
    `Archives read      ${r.archivesRead}  (${r.recordsRead.toLocaleString()} records, ${r.elapsedMs} ms)`,
  );
  out.push(`Distinct bodies    ${r.archiveBodies.toLocaleString()} named in the archives`);
  out.push(
    `Records w/o BodyID ${r.recordsWithoutBodyId.toLocaleString()} (${pct(r.recordsWithoutBodyId, r.recordsRead)} %)`,
  );
  out.push("");
  out.push(
    `Planet rows        ${r.planetRows.toLocaleString()}  matched ${r.planetsMatched.toLocaleString()} ` +
      `(${pct(r.planetsMatched, r.planetRows)} %)  unmatched ${r.planetsUnmatched.toLocaleString()}`,
  );
  out.push(
    `Coverage now       ${r.coverage.planetsWithBodyId.toLocaleString()}/${r.coverage.planets.toLocaleString()} planets ` +
      `have body_id, ${r.coverage.systemsWithEdsmId.toLocaleString()}/${r.coverage.systems.toLocaleString()} systems have edsm_id`,
  );
  if (applied) {
    out.push(
      `Written            ${r.planetsWritten.toLocaleString()} planet rows, ${r.systemsWritten.toLocaleString()} system rows`,
    );
  } else {
    out.push(`Written            nothing — dry run. Re-run with --apply to write.`);
  }

  out.push("");
  // "Beyond 2^53" is the honest claim; "rounded" would be very slightly too strong. At ~8.3e17 a
  // float64 steps in 128s, so about 1 value in 128 happens to land exactly. None of them can be
  // *trusted*, which is what makes Phase 2 necessary — but they are not all provably wrong.
  out.push(
    `id64 on disk       ${r.id64Damaged.toLocaleString()}/${r.id64Seen.toLocaleString()} beyond 2^53 ` +
      `(${pct(r.id64Damaged, r.id64Seen)} %) — none can be trusted, Phase 2 re-collects them`,
  );

  out.push("");
  out.push("── What name-based identity cost ──");
  out.push(`Splits    ${r.identitySplits.length}  — one physical body under two names, counted twice`);
  for (const s of r.identitySplits.slice(0, 20)) {
    out.push(`   ${s.system} · BodyID ${s.bodyId}: ${s.bodies.join("  |  ")}`);
  }
  if (r.identitySplits.length > 20) out.push(`   … and ${r.identitySplits.length - 20} more`);
  out.push(`Collisions ${r.nameCollisions.length} — one name, two BodyIDs: two bodies averaged into one row`);
  for (const c of r.nameCollisions.slice(0, 20)) {
    out.push(`   ${c.system} · "${c.body}" → BodyIDs ${c.bodyIds.join(", ")}`);
  }
  if (r.nameCollisions.length > 20) out.push(`   … and ${r.nameCollisions.length - 20} more`);

  if (r.identitySplits.length === 0 && r.nameCollisions.length === 0) {
    out.push("");
    out.push("Nothing to merge. Name-based dedup has held so far, which makes Phase 2 a hardening");
    out.push("exercise rather than a repair — the identity key still has to exist before a second");
    out.push("contributor arrives, because names are the only join a second source would have.");
  }
  return out.join("\n");
}
