/**
 * A candidate the model scored at 2.7 % does not belong beside one it scored at 100 %.
 *
 * Reported from the field on Blu Thua LJ-F c25-8 B 1 a — an icy moon under the second star, two
 * biological signals, and the panel offering Fonticulua upupam and a Fungoida under 5 % alongside a
 * Fonticulua campestris the model was certain of. Nothing was wrong with the numbers; the panel was
 * showing rows its own model had already judged.
 */
import { describe, expect, it } from "vitest";
import {
  GENUS_SHARE_FLOOR_PCT,
  PRESENCE_FLOOR_PCT,
  demoteBelowPresenceFloor,
} from "../src/server/snapshot.js";
import { floorKeptReason, markSampledDespiteUnlikely, signalMultipliers, signalSlots, twinGenusRows } from "../src/server/presenceFloors.js";
import { collectOwnOrganicLockSpeciesIds } from "../src/server/organicLocks.js";
import { loadSpeciesDatabase } from "../src/server/snapshot.js";
import type { BodyExoState, SpeciesDatabase, SpeciesMatch } from "../src/shared/types.js";

const db: SpeciesDatabase = { species: [] };

function body(over: Partial<BodyExoState> = {}): BodyExoState {
  return {
    key: "1:2",
    bodyName: "Test 1 a",
    bodyId: 2,
    systemAddress: 1,
    starSystem: "Test",
    biologicalSignals: 2,
    genusHints: null,
    dssComplete: false,
    scan: null,
    organicGenusLocks: [],
    confirmedVariants: [],
    updatedAt: "2026-01-01T00:00:00Z",
    ...over,
  };
}

function match(id: string, pct: number | null, over: Partial<SpeciesMatch> = {}): SpeciesMatch {
  return {
    /*
      `genusDataDir` is what the app groups and folders by, and the post-DSS floor keeps one row per
      genus — leave it off and every row lands in the same nameless group, which is how the
      "never empties a genus" case first failed here.
    */
    entry: {
      id,
      displayName: id,
      genus: id.split("_")[0]!,
      genusDataDir: id.split("_")[0]!,
    } as SpeciesMatch["entry"],
    reasons: [],
    photoUrl: "",
    photoNote: null,
    priceCredits: null,
    presenceProbabilityPercent: pct,
    ...over,
  } as SpeciesMatch;
}

const shownIds = (ms: SpeciesMatch[]) => ms.filter((m) => !m.unlikely).map((m) => m.entry.id);

describe("the chance floor", () => {
  it("demotes the long shots and keeps the rest", () => {
    // The floor is 1 % since 2026-10-03 (owner: no misses); long shots under it still step aside.
    const ms = [
      match("fonticulua_campestris", 100),
      match("fonticulua_upupam", 0.7),
      match("fungoida_bullarum", 0.3),
    ];
    demoteBelowPresenceFloor(ms, body({ biologicalSignals: 1 }), db);
    expect(shownIds(ms)).toEqual(["fonticulua_campestris"]);
    expect(ms[1]!.unlikelyReasons?.[0]?.detail).toContain("0.7 %");
  });

  // Owner 2026-11-11 (review 2026-11-10 A7): one signal is one genus. Two signals, two candidate genera: both stay.
  it("never shows fewer genera than the body has signals: the best row of each emptied genus comes back", () => {
    const ms = [
      match("fonticulua_campestris", 100),
      match("fonticulua_upupam", 0.7),
      match("fungoida_bullarum", 0.3),
      match("fungoida_setisis", 0.6),
    ];
    demoteBelowPresenceFloor(ms, body({ biologicalSignals: 2 }), db);
    expect(shownIds(ms)).toEqual(["fonticulua_campestris", "fungoida_setisis"]);
    // Brain Trees: several species on one body, a signal each.
    const trees = [match("stratum_x", 90), match("brain-tree_a", 0.5), match("brain-tree_b", 0.4), match("brain-tree_c", 0.1)];
    for (const t of trees.slice(1)) (t.entry as { genusDataDir: string }).genusDataDir = "brain-tree";
    demoteBelowPresenceFloor(trees, body({ biologicalSignals: 3 }), db);
    expect(shownIds(trees)).toEqual(["stratum_x", "brain-tree_a", "brain-tree_b"]);
  });

  // Review 2026-11-10 A3: a twin moon's DSS genera are a hint here, not this body's list. The likeliest row of each
  // stays listed until this body has its own DSS; the twin's species is not the hint (twins differ by up to 120 K).
  it("keeps the likeliest row of each genus a twin moon's DSS named, until this body's own DSS", () => {
    const twin = [{ Genus: "$Codex_Ent_Fungoids_Genus_Name;", Genus_Localised: "Fungoida" }];
    const rows = () => [
      match("fonticulua_campestris", 100),
      match("fungoida_bullarum", 0.3),
      match("fungoida_setisis", 0.6),
    ];
    const ms = rows();
    demoteBelowPresenceFloor(ms, body({ siblingGenusHints: twin }), db);
    expect(shownIds(ms)).toEqual(["fonticulua_campestris", "fungoida_setisis"]);
    // Once this body has its own DSS list, the twin's says nothing.
    expect(twinGenusRows(rows(), body({ siblingGenusHints: twin, genusHints: twin })).size).toBe(0);
    expect([...twinGenusRows(rows(), body({ siblingGenusHints: twin }))].map((m) => m.entry.id)).toEqual(["fungoida_setisis"]);
  });

  it("keeps the best row rather than emptying the panel", () => {
    const ms = [match("a", 0.8), match("b", 0.6), match("c", 0.2)];
    demoteBelowPresenceFloor(ms, body({ biologicalSignals: 1 }), db);
    // One row for one signal, and the right one; one per signal since 2026-11-11 (A7).
    expect(shownIds(ms)).toEqual(["a"]);
    const two = [match("a", 0.8), match("b", 0.6), match("c", 0.2)];
    demoteBelowPresenceFloor(two, body(), db);
    expect(shownIds(two)).toEqual(["a", "b"]);
  });

  it("leaves an unmeasured row alone", () => {
    // Null is "the model has no opinion", never "unlikely".
    const ms = [match("a", 90), match("b", null)];
    demoteBelowPresenceFloor(ms, body(), db);
    expect(shownIds(ms)).toEqual(["a", "b"]);
  });

  it("never argues with the commander's own boots", () => {
    const ms = [
      match("a", 90),
      match("b", 1, { organicAnalysisComplete: true }),
      match("c", 1, { approximateMatch: true }),
    ];
    demoteBelowPresenceFloor(ms, body(), db);
    expect(shownIds(ms)).toEqual(["a", "b", "c"]);
  });

  it("does not touch a row already behind the unlikely tier", () => {
    const ms = [match("a", 90), match("b", 2, { unlikely: true, unlikelyReasons: [] })];
    demoteBelowPresenceFloor(ms, body(), db);
    expect(ms[1]!.unlikelyReasons).toEqual([]);
  });

  it("keeps a row exactly at the floor", () => {
    const ms = [match("a", 90), match("b", PRESENCE_FLOOR_PCT)];
    demoteBelowPresenceFloor(ms, body(), db);
    expect(shownIds(ms)).toEqual(["a", "b"]);
  });
});

describe("the chance floor, row by row (mutation run 2026-11-14)", () => {
  // One signal, so the count rule (it keeps a genus per signal) does not hide what the floor itself did.
  const one = () => body({ biologicalSignals: 1 });

  it("says why each row it left stands there", () => {
    const ms = [
      match("a_one", 40),
      match("a_two", 0.2, { organicAnalysisComplete: true }),
      match("a_three", 0.2, { approximateMatch: true }),
      match("a_four", 0.4),
    ];
    demoteBelowPresenceFloor(ms, one(), db);
    expect(shownIds(ms)).toEqual(["a_one", "a_two", "a_three"]);
    expect(ms.map((m) => floorKeptReason(m)?.why ?? null)).toEqual(["passed", "sampled", "approximate", null]);
    // Nothing clears: the best of them stays, as "best".
    const low = [match("a_one", 0.4), match("a_two", 0.6)];
    demoteBelowPresenceFloor(low, one(), db);
    expect(shownIds(low)).toEqual(["a_two"]);
    expect(floorKeptReason(low[1]!)).toEqual({ why: "best", pct: 0.6 });
  });

  it("keeps a row exactly at the floor on its own merit, not as the one row kept", () => {
    const ms = [match("a_one", 90), match("a_two", PRESENCE_FLOOR_PCT)];
    demoteBelowPresenceFloor(ms, one(), db);
    expect(shownIds(ms)).toEqual(["a_one", "a_two"]);
    expect(floorKeptReason(ms[1]!)?.why).toBe("passed");
  });

  it("says what chance the row had and what the floor is", () => {
    const ms = [match("a_one", 90), match("a_two", 0.4)];
    demoteBelowPresenceFloor(ms, one(), db);
    expect(ms[1]!.unlikelyReasons).toEqual([
      {
        field: "Chance here",
        detail: `0.4 % — under the ${PRESENCE_FLOOR_PCT} % this panel shows. Listed as a low-probability find rather than excluded.`,
      },
    ]);
  });

  it("leaves a chance that is not a number alone, and judges only the rows still shown", () => {
    const odd = [match("a_one", 90), match("a_two", Number.NaN)];
    demoteBelowPresenceFloor(odd, one(), db);
    expect(shownIds(odd)).toEqual(["a_one", "a_two"]);
    expect(floorKeptReason(odd[1]!)).toBeNull();
    const ms = [match("a_one", 90, { unlikely: true }), match("a_two", 0.4)];
    demoteBelowPresenceFloor(ms, one(), db);
    expect(shownIds(ms)).toEqual(["a_two"]);
  });

  it("keeps a twin moon's genus, its likeliest row, as \"twin\"", () => {
    const b = body({
      biologicalSignals: 1,
      siblingGenusHints: [{ Genus: "$Codex_Ent_Bacterial_Genus_Name;", Genus_Localised: "Bacterium" }],
    });
    const ms = [match("fonticulua_campestris", 90), match("bacterium_tela", 0.2), match("bacterium_aurasus", 0.4)];
    for (const m of ms.slice(1)) m.entry.genusDataDir = "bacterium";
    ms[1]!.entry.genus = ms[2]!.entry.genus = "Bacterium";
    demoteBelowPresenceFloor(ms, b, db);
    expect(shownIds(ms)).toEqual(["fonticulua_campestris", "bacterium_aurasus"]);
    expect(floorKeptReason(ms[2]!)?.why).toBe("twin");
  });

  it("brings back one row per genus the signal count still needs, never a second of a genus shown", () => {
    // Three signals; the list shows two genera, so one more genus comes back (C), not a second Aleoida.
    const ms = [match("a_one", 90), match("b_one", 50), match("a_two", 0.5), match("c_one", 0.2)];
    demoteBelowPresenceFloor(ms, body({ biologicalSignals: 3 }), db);
    expect(shownIds(ms)).toEqual(["a_one", "b_one", "c_one"]);
    expect(floorKeptReason(ms[3]!)).toEqual({ why: "count", pct: 0.2 });
    // One signal, or a count that is not a number: no row comes back that way.
    for (const n of [1, Number.NaN]) {
      const rows = [match("a_one", 90), match("c_one", 0.2)];
      demoteBelowPresenceFloor(rows, body({ biologicalSignals: n }), db);
      expect([n, shownIds(rows)]).toEqual([n, ["a_one"]]);
    }
  });

  it("counts every Brain Tree as a signal of its own", () => {
    expect(signalSlots([match("a_one", 1), match("a_two", 1), match("b_one", 1)])).toBe(2);
    expect(signalSlots([match("brain-tree_x", 1), match("brain-tree_y", 1), match("a_one", 1)])).toBe(3);
    const ms = [match("brain-tree_x", 90), match("brain-tree_y", 0.4), match("brain-tree_z", 0.3)];
    demoteBelowPresenceFloor(ms, body({ biologicalSignals: 3 }), db);
    expect(shownIds(ms)).toEqual(["brain-tree_x", "brain-tree_y", "brain-tree_z"]);
  });
});

describe("a twin moon's genera", () => {
  const b = { genusHints: null, siblingGenusHints: [{ Genus: "$Codex_Ent_Bacterial_Genus_Name;", Genus_Localised: "Bacterium" }] };
  const bact = (id: string, pct: number | null) => {
    const m = match(id, pct);
    m.entry.genusDataDir = "bacterium";
    m.entry.genus = "Bacterium";
    return m;
  };

  it("keeps the likeliest shown row of each, an unmeasured one first", () => {
    const ms = [bact("bacterium_tela", 0.2), bact("bacterium_aurasus", 3), bact("bacterium_acies", 1)];
    expect([...twinGenusRows(ms, b)].map((m) => m.entry.id)).toEqual(["bacterium_aurasus"]);
    const withNull = [bact("bacterium_tela", 3), bact("bacterium_acies", null)];
    expect([...twinGenusRows(withNull, b)].map((m) => m.entry.id)).toEqual(["bacterium_acies"]);
    // Of two equal chances the first stays.
    const tie = [bact("bacterium_tela", 3), bact("bacterium_acies", 3)];
    expect([...twinGenusRows(tie, b)].map((m) => m.entry.id)).toEqual(["bacterium_tela"]);
  });
});

describe("after a DSS", () => {
  /**
   * Probes name the genera, and the matcher drops every candidate outside them. What is left is no
   * longer "might any of this be here" but "which of this is it" — so the presence probability stops
   * being the right question and the share of its own genus becomes it.
   *
   * **This reverses an earlier reading of the same code**, and the reversal is the owner's, from the
   * field: *"I shouldn't be getting Tela as a suggestion for every single body with 1 bio signal."*
   * This function used to return early on any probed body, on the argument that a 2.3 % row beside a
   * 97 % one is a real answer, the only other thing it could be. Measured on his cache, that argument
   * was paying for itself in noise: **Bacterium tela sat on 546 of 574 probed bodies (95.1 %) at a
   * median 1.9 % of its own genus**, against 13.7 % on the never-probed bodies where the floor did
   * run. The structural reason is that tela's only condition is "any thin atmosphere", so on most
   * bodies the matcher narrows Bacterium to exactly two rows — the atmosphere's own species, and
   * tela. It was not a long tail. It was a permanent second row.
   *
   * The cost was measured on the same cache: across 609 species he has confirmed on probed bodies, a
   * 5 % floor would have hidden **two** beforehand, and both return the moment he samples them.
   */
  const withDss = (genus = "Fonticulua") =>
    body({
      genusHints: [{ Genus: `$Codex_Ent_${genus}_Genus_Name;`, Genus_Localised: genus }],
    });

  const share = (id: string, pct: number | null, over: Partial<SpeciesMatch> = {}) =>
    match(id, null, { genusSharePercent: pct, ...over });

  it("floors on the share of the genus, not on the chance of the body", () => {
    // The field case, reduced: one signal, Bacterium named, and tela as the permanent runner-up.
    const ms = [share("bacterium_aurasus", 99.2), share("bacterium_tela", 0.8)];
    demoteBelowPresenceFloor(ms, withDss("Bacterium"), db);
    expect(shownIds(ms)).toEqual(["bacterium_aurasus"]);
    expect(ms[1]!.unlikelyReasons?.[0]?.field).toBe("Share of its genus");
    expect(ms[1]!.unlikelyReasons?.[0]?.detail).toContain("0.8 %");
  });

  it("keeps a row that holds a real share of its genus", () => {
    // Both of the bodies where tela actually grew were 39.4 % and 98.0 % of Bacterium.
    const ms = [share("bacterium_aurasus", 60.6), share("bacterium_tela", 39.4)];
    demoteBelowPresenceFloor(ms, withDss("Bacterium"), db);
    expect(shownIds(ms)).toEqual(["bacterium_aurasus", "bacterium_tela"]);
  });

  it("never empties a genus, even when nothing in it clears", () => {
    /*
      Two genera on one body, one of them thin all the way down. The best row of each survives: the
      probe said that genus is present, so refusing to name any of its species would contradict the
      game rather than the model.
    */
    const ms = [
      share("fonticulua_campestris", 97),
      share("fonticulua_upupam", 0.3),
      share("bacterium_aurasus", 0.8),
      share("bacterium_tela", 0.4),
    ];
    demoteBelowPresenceFloor(ms, withDss(), db);
    expect(shownIds(ms)).toEqual(["fonticulua_campestris", "bacterium_aurasus"]);
  });

  it("leaves a row the model never scored", () => {
    const ms = [share("fonticulua_campestris", 97), share("fonticulua_upupam", null)];
    demoteBelowPresenceFloor(ms, withDss(), db);
    expect(shownIds(ms)).toEqual(["fonticulua_campestris", "fonticulua_upupam"]);
  });

  it("never argues with the commander's own boots", () => {
    const ms = [
      share("fonticulua_campestris", 97),
      share("fonticulua_upupam", 1, { organicAnalysisComplete: true }),
      share("fonticulua_fluctus", 1, { approximateMatch: true }),
    ];
    demoteBelowPresenceFloor(ms, withDss(), db);
    expect(shownIds(ms)).toEqual(["fonticulua_campestris", "fonticulua_upupam", "fonticulua_fluctus"]);
  });

  it("keeps a row exactly at the floor", () => {
    const ms = [share("a_one", 95), share("a_two", GENUS_SHARE_FLOOR_PCT)];
    demoteBelowPresenceFloor(ms, withDss(), db);
    expect(shownIds(ms)).toEqual(["a_one", "a_two"]);
  });

  it("reads the share and not the chance, which on a probed body says something else", () => {
    /*
      The sabotage check for the change: these rows would both survive a presence floor — 40 % and
      20 % are well clear of the floor — and the second is still only 0.5 % of its genus. If this
      function ever goes back to reading `presenceProbabilityPercent` here, this is the test that says so.
    */
    const ms = [
      match("a_one", 40, { genusSharePercent: 99.5 }),
      match("a_two", 20, { genusSharePercent: 0.5 }),
    ];
    demoteBelowPresenceFloor(ms, withDss(), db);
    expect(shownIds(ms)).toEqual(["a_one"]);
  });

  /*
    Mutation run 2026-11-14 (plan 2.5): the rows above sit at exactly 1 %, which clears the floor anyway, so the
    exemptions and the reason each kept row carries were never put to the test. These are far under it.
  */
  it("keeps the commander's own and the approximate rows far under the floor, and says why each row stayed", () => {
    const ms = [
      share("fonticulua_campestris", 97),
      share("fonticulua_upupam", 0.2, { organicAnalysisComplete: true }),
      share("fonticulua_fluctus", 0.2, { approximateMatch: true }),
      share("bacterium_aurasus", 0.6),
      share("bacterium_tela", 0.4),
    ];
    demoteBelowPresenceFloor(ms, withDss(), db);
    expect(shownIds(ms)).toEqual(["fonticulua_campestris", "fonticulua_upupam", "fonticulua_fluctus", "bacterium_aurasus"]);
    expect(ms.map((m) => floorKeptReason(m)?.why ?? null)).toEqual(["genusShare", "sampled", "approximate", "genusBest", null]);
    expect(floorKeptReason(ms[3]!)?.pct).toBe(0.6);
  });

  it("counts an unmeasured row as its genus's survivor, whatever order the rows came in", () => {
    // Unmeasured sorts first (no claim is not a weak claim) and is the one row the genus keeps, so both weak rows go.
    const ms = [share("fonticulua_fluctus", 0.4), share("fonticulua_upupam", 0.6), share("fonticulua_campestris", null)];
    demoteBelowPresenceFloor(ms, withDss(), db);
    expect(shownIds(ms)).toEqual(["fonticulua_campestris"]);
    expect(floorKeptReason(ms[2]!)).toBeNull();
    // Of two weak rows the better one is kept, from either order.
    for (const order of [[0.4, 0.6], [0.6, 0.4]]) {
      const rows = order.map((p, i) => share(`fonticulua_r${i}`, p));
      demoteBelowPresenceFloor(rows, withDss(), db);
      expect(rows.filter((m) => !m.unlikely).map((m) => m.genusSharePercent)).toEqual([0.6]);
    }
  });

  it("leaves a share that is not a number alone, and judges only the rows still shown", () => {
    const odd = [share("fonticulua_campestris", 97), share("fonticulua_upupam", Number.NaN)];
    demoteBelowPresenceFloor(odd, withDss(), db);
    expect(shownIds(odd)).toEqual(["fonticulua_campestris", "fonticulua_upupam"]);
    expect(floorKeptReason(odd[1]!)).toBeNull();
    // A row already behind the fold does not count as the genus's survivor: the weak shown one is still its best.
    const ms = [share("bacterium_aurasus", 50, { unlikely: true }), share("bacterium_tela", 0.4)];
    demoteBelowPresenceFloor(ms, withDss("Bacterium"), db);
    expect(shownIds(ms)).toEqual(["bacterium_tela"]);
  });

  it("says what share of which genus the row had", () => {
    const ms = [share("bacterium_aurasus", 99.6), share("bacterium_tela", 0.4)];
    ms[1]!.entry.genus = "";
    demoteBelowPresenceFloor(ms, withDss("Bacterium"), db);
    expect(ms[1]!.unlikelyReasons?.[0]?.detail).toBe(
      `0.4 % of bacterium here — under the ${GENUS_SHARE_FLOOR_PCT} % this panel shows once the genus is confirmed. ` +
        "Listed as a low-probability find rather than excluded.",
    );
  });

  it("still applies the chance floor when the genera are not named", () => {
    const ms = [match("fonticulua_campestris", 97), match("fonticulua_upupam", 0.6)];
    demoteBelowPresenceFloor(ms, body({ genusHints: null }), db);
    expect(shownIds(ms)).toEqual(["fonticulua_campestris"]);
  });
});

describe("Hypi Fraae RF-Q b21-2 B 4 (owner, 2026-10-03)", () => {
  /*
    Icy, thin neon, 20 K, Minor Methane Magma. Bacterium tela grew there; the app had it behind
    "show unlikely" at 2.6 % chance (FSS) and 4.9 % of Bacterium (DSS), under the old 5 % floors. On
    1,534 confirmed bodies of that kind the three split evenly (scopulum 33.8, tela 33.3, acies 32.9 %).
  */
  it("offers all three bacteria after the FSS", () => {
    const ms = [
      match("bacterium_acies", 57.1),
      match("bacterium_scopulum", 40.1),
      match("bacterium_tela", 2.6),
    ];
    demoteBelowPresenceFloor(ms, body(), db);
    expect(shownIds(ms)).toEqual(["bacterium_acies", "bacterium_scopulum", "bacterium_tela"]);
  });

  it("and after the DSS", () => {
    const ms = [
      match("bacterium_acies", null, { genusSharePercent: 55.9 }),
      match("bacterium_scopulum", null, { genusSharePercent: 39.2 }),
      match("bacterium_tela", null, { genusSharePercent: 4.9 }),
    ];
    demoteBelowPresenceFloor(
      ms,
      body({ genusHints: [{ Genus: "$Codex_Ent_Bacterial_Genus_Name;", Genus_Localised: "Bacterium" }] }),
      db,
    );
    expect(shownIds(ms)).toEqual(["bacterium_acies", "bacterium_scopulum", "bacterium_tela"]);
  });
});

// Plan 1.2.17 Part 4 (2026-10-14): two species are held to 0.3 %, measured on the September hold-outs.
describe("the per-species presence floor", () => {
  it("keeps Concha labiata at 0.5 % where another species at 0.5 % goes to unlikely", () => {
    const ms = [
      match("bacterium_x", 90),
      match("concha_concha_labiata", 0.5),
      match("concha_concha_renibus", 0.5),
    ];
    demoteBelowPresenceFloor(ms, body({ biologicalSignals: 1 }), db);
    expect(ms.find((m) => m.entry.id === "concha_concha_labiata")!.unlikely).toBeFalsy();
    expect(ms.find((m) => m.entry.id === "concha_concha_renibus")!.unlikely).toBe(true);
    const low = [match("bacterium_x", 90), match("concha_concha_labiata", 0.2)];
    demoteBelowPresenceFloor(low, body({ biologicalSignals: 1 }), db);
    expect(low[1]!.unlikely).toBe(true);
    expect(low[1]!.unlikelyReasons?.[0]?.detail).toMatch(/under the 0\.3 %/);
  });
});

/**
 * The signals the game counted are all spent (2026-10-14). HIP 10861 B 2 d, two signals, a DSS listing Bacterium and
 * Anemone: cerbrus held 99 % of the posterior and read 100 % (198 % unclipped), the Anemone 0.7 %, under the floor.
 */
describe("signal multipliers", () => {
  const row = (id: string, s: number) => ({ match: match(id, null), s });
  const run = (rows: { match: SpeciesMatch; s: number }[], n: number) =>
    signalMultipliers(rows, (r) => r.s, n);

  it("hands a filled genus's leftover signal to the other genera", () => {
    const m = run([row("bacterium_cerbrus", 0.99), row("anemone_prasinum", 0.01)], 2);
    expect(m.get("bacterium")).toBe(2);
    // One signal left, 1 % of the posterior left: the Anemone takes the whole signal.
    expect(0.01 * m.get("anemone")!).toBeCloseTo(1, 6);
  });

  it("shares out only the signals left, never more than the body has", () => {
    // Two signals: Bacterium fills one, Anemone and Concha share the other in proportion (0.6 and 0.4), not one each.
    const m = run([row("bacterium_cerbrus", 0.9), row("anemone_prasinum", 0.06), row("concha_renibus", 0.04)], 2);
    expect(0.9 * m.get("bacterium")!).toBeGreaterThanOrEqual(1);
    expect(0.06 * m.get("anemone")!).toBeCloseTo(0.6, 6);
    expect(0.04 * m.get("concha")!).toBeCloseTo(0.4, 6);
  });

  it("leaves the count alone when no genus fills a signal", () => {
    const m = run([row("bacterium_cerbrus", 0.3), row("stratum_paleas", 0.3), row("anemone_prasinum", 0.4)], 2);
    expect([...m.values()]).toEqual([2, 2, 2]);
  });

  it("does not hand the leftover to a filled genus's own siblings", () => {
    const m = run([row("bacterium_cerbrus", 0.7), row("bacterium_tela", 0.25), row("stratum_paleas", 0.05)], 2);
    expect(m.get("bacterium")).toBe(2);
    expect(0.05 * m.get("stratum")!).toBeCloseTo(1, 6);
  });

  it("caps a genus that fills only after the first round at a whole signal", () => {
    // Three signals: Bacterium fills on the count; then 2 signals over 0.4 of posterior lift Stratum (0.3) past one.
    const m = run([row("bacterium_cerbrus", 0.6), row("stratum_paleas", 0.3), row("anemone_prasinum", 0.1)], 3);
    expect(m.get("bacterium")).toBe(3);
    expect(0.3 * m.get("stratum")!).toBeCloseTo(1, 6);
    expect(0.1 * m.get("anemone")!).toBeCloseTo(1, 6);
  });

  it("never lowers a chance below the plain count", () => {
    const m = run([row("bacterium_cerbrus", 1)], 1);
    expect(m.get("bacterium")).toBe(1);
  });
});

describe("a species sampled here, behind the unlikely tier", () => {
  // The function itself (sampledDespiteUnlikely.test.ts covers where the row is then filed); mutation run 2026-11-14.
  const realDb = loadSpeciesDatabase();
  const lock = {
    genusLocalised: "Stratum",
    genusSymbol: "",
    speciesLocalised: "Stratum Laminamus",
    speciesSymbol: "",
    variantLocalised: "",
    source: "foot" as const,
  };

  it("marks a demoted row the commander sampled, and a demoted row the game analysed, but nothing else", () => {
    const id = collectOwnOrganicLockSpeciesIds([lock], realDb)[0]!;
    expect(id).toBeTruthy();
    const ms = [
      match(id, 0.2, { unlikely: true }),
      match("stratum_other", 0.2, { unlikely: true }),
      match("bacterium_x", 50, { unlikely: true, organicAnalysisComplete: true }),
      match("bacterium_y", 50),
      match("bacterium_z", 50, { organicAnalysisComplete: true }),
    ];
    markSampledDespiteUnlikely(ms, body({ organicGenusLocks: [lock] }), realDb);
    expect(ms.map((m) => m.sampledHere === true)).toEqual([true, false, true, false, false]);
  });

  it("marks nothing when nothing was sampled on this body (a twin moon's lock is not this body's)", () => {
    const ms = [match("bacterium_x", 50, { unlikely: true, organicAnalysisComplete: true })];
    markSampledDespiteUnlikely(ms, body({ organicGenusLocks: [{ ...lock, fromSibling: true } as never] }), realDb);
    expect(ms[0]!.sampledHere).toBeUndefined();
  });
});
