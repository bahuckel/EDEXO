/**
 * The EDDN collector's codex ledger (owner, 2026-10-04, plan O-G): when one runs on this machine, plants
 * relayed since EDSM's dump count against [CODEX FIRST]; when none does, nothing changes.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { codexFirstCheck, resetCodexFirst } from "../src/server/codexFirst.js";
import {
  eddnLedgerStatus,
  ledgerTokenToCodexId,
  parseLedger,
  refreshEddnLedger,
  startEddnLedgerWatch,
} from "../src/server/eddnLedger.js";
import { getProjectRoot } from "../src/server/paths.js";

const root = getProjectRoot();
const manifest = '{"kind":"manifest","source":"eddn-bio-collector","content":"codex-ledger","formatVersion":1}';
const row = (token: string, region: string, category = "$Codex_Category_Biology;") =>
  JSON.stringify({ kind: "codex", token, region, category, systemId64: "1", bodyId: 2 });
const fakeFetch = (body: string, ok = true) =>
  (async () => new Response(body, { status: ok ? 200 : 500 })) as unknown as typeof fetch;

afterEach(() => resetCodexFirst());

describe("the EDDN collector's ledger", () => {
  it("reads its tokens as EDSM's codex ids, plants only", () => {
    expect(ledgerTokenToCodexId("$Codex_Ent_Aleoids_01_A_Name;")).toBe("codex_ent_aleoids_01_a");
    const ids = parseLedger(
      [manifest, row("$Codex_Ent_Aleoids_01_A_Name;", "Inner Orion Spur"), row("$Codex_Ent_Black_Holes_Name;", "Outer Arm", "$Codex_Category_StellarBodies;")].join("\n"),
    );
    expect([...ids]).toHaveLength(1);
    expect([...ids][0]).toMatch(/\|codex_ent_aleoids_01_a$/);
  });

  it("a plant on the ledger is no longer a first; without the collector it is again", async () => {
    // Cactoida Cortexum - Green is not in EDSM's dump for Errant Marches (data/codex, generated 2026-10-01).
    const region = "Errant Marches";
    expect(codexFirstCheck(root, region, "Cactoida Cortexum", "Green", null)).not.toBeNull();
    await refreshEddnLedger(root, fakeFetch([manifest, row("$Codex_Ent_Cactoid_01_A_Name;", region)].join("\n")));
    expect(eddnLedgerStatus()).toMatchObject({ found: true, plantRows: 1 });
    expect(codexFirstCheck(root, region, "Cactoida Cortexum", "Green", null)).toBeNull();
    // Another colour of it is still a first: the ledger names the colour.
    expect(codexFirstCheck(root, region, "Cactoida Cortexum", "Mauve", null)).not.toBeNull();
    await refreshEddnLedger(root, fakeFetch("", false));
    expect(eddnLedgerStatus().found).toBe(false);
    expect(codexFirstCheck(root, region, "Cactoida Cortexum", "Green", null)).not.toBeNull();
  });

  it("reads the answer as it streams in, rows cut across chunks (2026-10-19: 43 MB read whole stalled the boot)", async () => {
    const text = [
      manifest,
      row("$Codex_Ent_Cactoid_01_A_Name;", "Errant Marches"),
      row("$Codex_Ent_Aleoids_01_A_Name;", 'Inner "Orion" Spur'), // an escaped quote: the fallback path
      row("$Codex_Ent_Black_Holes_Name;", "Outer Arm", "$Codex_Category_StellarBodies;"),
    ].join("\n");
    const bytes = new TextEncoder().encode(text);
    const chunked = (size: number) =>
      (async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(c) {
              for (let i = 0; i < bytes.length; i += size) c.enqueue(bytes.slice(i, i + size));
              c.close();
            },
          }),
        )) as unknown as typeof fetch;
    const whole = parseLedger(text);
    expect(whole.size).toBe(2);
    for (const size of [1, 7, 64, 100_000]) {
      const s = await refreshEddnLedger(root, chunked(size));
      expect(s).toMatchObject({ found: true, plantRows: 2 });
    }
    expect([...whole].some((k) => k.endsWith("|codex_ent_aleoids_01_a"))).toBe(true);
    // Not a ledger: refused, nothing kept.
    expect((await refreshEddnLedger(root, fakeFetch('{"kind":"other"}\n' + row("$Codex_Ent_Cactoid_01_A_Name;", "Errant Marches")))).found).toBe(false);
  });

  it("the watch asks only once the journal boot is over", async () => {
    let calls = 0;
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      calls++;
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    try {
      let open!: () => void;
      const booted = new Promise<void>((r) => (open = r));
      const stop = startEddnLedgerWatch(root, booted);
      await new Promise((r) => setTimeout(r, 20));
      expect(calls).toBe(0);
      open();
      await new Promise((r) => setTimeout(r, 20));
      expect(calls).toBe(1);
      stop();
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("keeps what it read, and next time asks only for rows since the latest one (two days back)", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "edexo-ledger-"));
    const file = path.join(dir, "ledger.json");
    const asked: string[] = [];
    const answering = (body: string) =>
      (async (url: string) => {
        asked.push(String(url));
        return new Response(body);
      }) as unknown as typeof fetch;
    const dated = (token: string, region: string, firstSeen: string) =>
      JSON.stringify({ kind: "codex", token, region, category: "$Codex_Category_Biology;", firstSeen });
    const first = [
      manifest,
      dated("$Codex_Ent_Cactoid_01_A_Name;", "Errant Marches", "2026-10-20T10:00:00Z"),
      dated("$Codex_Ent_Aleoids_01_A_Name;", "Inner Orion Spur", "2026-10-25T12:00:00Z"),
    ].join("\n");
    expect(await refreshEddnLedger(root, answering(first), "http://ledger", file)).toMatchObject({ found: true, plantRows: 2 });
    expect(asked[0]).not.toContain("2026-10-23");
    // The second answer holds only the new row; the two kept ones stay.
    const second = [manifest, dated("$Codex_Ent_Cactoid_02_A_Name;", "Errant Marches", "2026-10-26T08:00:00Z")].join("\n");
    expect(await refreshEddnLedger(root, answering(second), "http://ledger", file)).toMatchObject({ found: true, plantRows: 3 });
    expect(decodeURIComponent(asked[1]!)).toContain("since=2026-10-23T12:00:00.000Z");
    // Without the file it is a whole read again.
    rmSync(file);
    expect(await refreshEddnLedger(root, answering(second), "http://ledger", file)).toMatchObject({ plantRows: 1 });
    expect(asked[2]).toBe(asked[0]);
    rmSync(dir, { recursive: true, force: true });
  });

  it("stays quiet when nothing answers", async () => {
    const s = await refreshEddnLedger(root, (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch);
    expect(s.found).toBe(false);
  });
});
