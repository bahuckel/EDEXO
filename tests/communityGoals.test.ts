/**
 * Community Goals (owner, 2026-10-16): Frontier's public list read into notices — src/server/communityGoals.ts.
 * The fixture is the list as Frontier served it on 2025-08-21 (the news text shortened).
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  COMMUNITY_GOALS_URL,
  communityGoalNoticeText,
  parseCommunityGoals,
  startCommunityGoalPoller,
} from "../src/server/communityGoals.js";
import { createNoticesService } from "../src/server/notices.js";
import { DEFAULT_NOTIFY_PREFS, mergeNotifyPrefs } from "../src/shared/notices.js";

const served = {
  activeInitiatives: [
    {
      id: "829",
      title: "Brewer Corporation calls for Trailblazer resupply",
      expiry: "2025-08-21 10:00:00",
      market_name: "Starlace Station",
      starsystem_name: "Minerva",
      activityType: "tradelist",
      target_commodity_list: "Titanium, Aluminium, CMM Composite, Steel",
      target_qty: "1500000000",
      qty: "1242480802",
      objective: "Titanium, Aluminium, CMM Composite, Steel",
      images: "NewsImageMarket",
      news:
        "Brewer corporation calls for Trailblazer resupply\n\nCommodities sold as part of this initiative will have a 10x price multiplier.\n\n" +
        "Pilots who register at least 1 contribution will receive the following rewards:\n\n" +
        "- 1x of each class 5 and 6 cargo rack, pre-engineered with increased cargo capacity.\n" +
        "- Red Metallic Brewer Decal\n- Credits, depending on success tier achieved and individual contribution level.\n\n{{top5}}",
    },
    { id: "", title: "no id", starsystem_name: "Sol" },
  ],
};

describe("reading Frontier's list", () => {
  it("reads a goal: where, what, until when, how far, and the rewards", () => {
    const [g, ...rest] = parseCommunityGoals(served);
    expect(rest).toHaveLength(0);
    expect(g).toMatchObject({
      id: "829",
      system: "Minerva",
      station: "Starlace Station",
      expiry: "2025-08-21T10:00:00.000Z",
      activity: "tradelist",
      progressPct: 83,
    });
    expect(g!.rewards).toEqual([
      "1x of each class 5 and 6 cargo rack, pre-engineered with increased cargo capacity.",
      "Red Metallic Brewer Decal",
      "Credits, depending on success tier achieved and individual contribution level.",
    ]);
    expect(communityGoalNoticeText(g!)).toBe(
      "Sign up at Starlace Station, Minerva. Objective: Titanium, Aluminium, CMM Composite, Steel. " +
        "Ends 2025-08-21 10:00 UTC. 83 % of the top target so far. Rewards: 1x of each class 5 and 6 cargo rack, " +
        "pre-engineered with increased cargo capacity; Red Metallic Brewer Decal; Credits, depending on success tier " +
        "achieved and individual contribution level.",
    );
  });

  it("reads no goal, and nothing from a broken answer", () => {
    expect(parseCommunityGoals({ activeInitiatives: [] })).toEqual([]);
    expect(parseCommunityGoals(null)).toEqual([]);
    expect(parseCommunityGoals({ activeInitiatives: "x" })).toEqual([]);
  });
});

describe("asking Frontier", () => {
  it("asks the public list for JSON and hands the goals on; a failure is quiet", async () => {
    const asked: string[] = [];
    let got: number | null = null;
    const ok = startCommunityGoalPoller({
      enabled: () => true,
      onGoals: (g) => (got = g.length),
      firstDelayMs: 1e9,
      fetchImpl: (async (url: string, init?: RequestInit) => {
        asked.push(`${url} ${(init?.headers as Record<string, string>).Accept}`);
        return new Response(JSON.stringify(served), { status: 200 });
      }) as typeof fetch,
    });
    expect((await ok.pollNow())?.length).toBe(1);
    expect(got).toBe(1);
    expect(asked).toEqual([`${COMMUNITY_GOALS_URL} application/json`]);
    ok.stop();
    const down = startCommunityGoalPoller({
      enabled: () => true,
      onGoals: () => {
        throw new Error("not called");
      },
      firstDelayMs: 1e9,
      fetchImpl: (async () => new Response("", { status: 503 })) as typeof fetch,
    });
    expect(await down.pollNow()).toBeNull();
    down.stop();
  });
});

describe("the notice", () => {
  const goal = { id: "829", title: "Trailblazer resupply", system: "Minerva", text: "Sign up at Starlace Station, Minerva." };

  it("is announced once per goal, ever", () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), "edexo-cg-")), "notices.json");
    const n = createNoticesService({ filePath: file });
    expect(n.announceCommunityGoal(goal, "2026-10-16T10:00:00Z")).toBe(true);
    expect(n.announceCommunityGoal(goal, "2026-10-16T11:00:00Z")).toBe(false);
    expect(n.list()[0]).toMatchObject({ kind: "cg", system: "Minerva", title: "Community Goal: Trailblazer resupply" });
    const again = createNoticesService({ filePath: file });
    expect(again.announceCommunityGoal(goal, "2026-10-16T12:00:00Z")).toBe(false);
  });

  it("is on by default, and stays quiet when switched off", () => {
    expect(DEFAULT_NOTIFY_PREFS.communityGoals).toBe(true);
    expect(mergeNotifyPrefs(DEFAULT_NOTIFY_PREFS, { communityGoals: false }).communityGoals).toBe(false);
    const n = createNoticesService({ filePath: null });
    n.setPrefs({ communityGoals: false });
    expect(n.announceCommunityGoal(goal, "2026-10-16T10:00:00Z")).toBe(false);
  });
});
