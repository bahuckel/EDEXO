/**
 * The update check's edges (plan 2.5 Stryker gaps, updateCheck after presenceFloors; 2026-11-24 run: 79 survivors,
 * 4 uncovered): each case fails when the comparison or the fallback it pins is loosened.
 */
import { describe, expect, it, vi } from "vitest";
import {
  compareVersions,
  createUpdateChecker,
  currentReleaseForm,
  parseReleaseTag,
  pickLatestRelease,
  RELEASES_API,
  releaseNotesBetween,
  releaseNotesSection,
} from "../src/server/updateCheck.js";
import { APP_USER_AGENT } from "../src/server/appVersion.js";

const HEX = "a".repeat(64);
const rel = (tag: string, extra: Record<string, unknown> = {}) => ({
  tag_name: tag,
  draft: false,
  prerelease: false,
  published_at: "2026-11-01T00:00:00Z",
  ...extra,
});
const exe = (extra: Record<string, unknown> = {}) => ({ name: "EDExoCompare.exe", digest: `sha256:${HEX}`, size: 1234, ...extra });
const notes = (text: string) => `Download it here.\n\n<!-- whats-new -->\n${text}\n<!-- /whats-new -->\n\nLicence text.`;

describe("tags and versions", () => {
  it("reads the whole tag only, with numbers of more than one digit", () => {
    expect(parseReleaseTag("xv1.2.3")).toBeNull();
    expect(parseReleaseTag("v12.34.56")).toEqual({ version: "12.34.56", parts: [12, 34, 56], zip: false });
    expect(parseReleaseTag("v1.20.3-zip")?.version).toBe("1.20.3");
  });

  it("compares versions of different lengths over the longer one", () => {
    expect(compareVersions("1.2", "1.2.1")).toBeLessThan(0);
    expect(compareVersions("1.2.0.1", "1.2")).toBeGreaterThan(0);
  });

  it("knows the AppImage", () => {
    expect(currentReleaseForm({ APPIMAGE: "/tmp/EDExoCompare.AppImage" })).toBe("appimage");
  });
});

describe("the file offered for download", () => {
  const pick = (assets: unknown[], extra: Record<string, unknown> = {}) =>
    pickLatestRelease([rel("v1.3.0", { assets, ...extra })], "portable")?.asset ?? null;

  it("is this form's file of the release, its address built from the tag", () => {
    expect(pick([null, { name: "other.zip", digest: `sha256:${"b".repeat(64)}` }, exe()])).toEqual({
      tag: "v1.3.0",
      name: "EDExoCompare.exe",
      url: "https://github.com/bahuckel/EDEXO/releases/download/v1.3.0/EDExoCompare.exe",
      size: 1234,
      sha256: HEX,
    });
  });

  it("needs a digest that is a string", () => {
    expect(pick([exe({ digest: [`sha256:${HEX}`] })])).toBeNull();
  });

  it("has a size only when it is a positive number", () => {
    expect(pick([exe({ size: 0 })])?.size).toBeNull();
    expect(pick([exe({ size: -5 })])?.size).toBeNull();
    expect(pick([exe({ size: "1234" })])?.size).toBeNull();
    expect(pick([exe({ size: 1 })])?.size).toBe(1);
  });

  it("never comes from a draft of the same tag", () => {
    const releases = [rel("v1.3.0", { draft: true, assets: [exe()] }), rel("v1.3.0", { assets: [exe({ digest: `sha256:${"c".repeat(64)}` })] })];
    expect(pickLatestRelease(releases, "portable")?.asset?.sha256).toBe("c".repeat(64));
  });
});

describe("the newest release", () => {
  it("ignores a newer draft and the entries that are not releases", () => {
    const p = pickLatestRelease([null, rel("v9.0.0", { draft: true }), { tag_name: 7 }, rel("v1.3.0")], "zip");
    expect(p?.version).toBe("1.3.0");
  });

  it("keeps the first published date of a version, and takes a later one when the first had none", () => {
    expect(
      pickLatestRelease([rel("v1.3.0-zip", { published_at: "A" }), rel("v1.3.0", { published_at: "B" })], "zip")?.publishedAt,
    ).toBe("A");
    expect(
      pickLatestRelease([rel("v1.3.0-zip", { published_at: null }), rel("v1.3.0", { published_at: "B" })], "zip")?.publishedAt,
    ).toBe("B");
    expect(pickLatestRelease([rel("v1.3.0", { published_at: 5 })], "zip")?.publishedAt).toBeNull();
  });
});

describe("the notes section", () => {
  it("turns Windows line ends into plain ones", () => {
    expect(releaseNotesSection(notes("## New\r\n- one\r\n- two"), "zip")).toBe("## New\n- one\n- two");
  });

  it("takes the marked part, a marker at the very start too, and falls back without both in order", () => {
    expect(releaseNotesSection("<!-- whats-new -->\nmarked\n<!-- /whats-new -->", "zip")).toBe("marked");
    const noEnd = "Intro line.\n\n## Changed\nsomething\n\n## Where your data lives\nfolder";
    expect(releaseNotesSection(`<!-- whats-new -->${noEnd}`, "zip")).toBe("<!-- whats-new -->Intro line.\n\n## Changed\nsomething");
    expect(releaseNotesSection(`<!-- /whats-new -->\n${noEnd}\n<!-- whats-new -->`, "zip")).not.toContain("folder");
    // An end marker alone is no marked part either.
    expect(releaseNotesSection(`${noEnd}\n<!-- /whats-new -->`, "zip")).toBe("Intro line.\n\n## Changed\nsomething");
  });

  it("stops at the data section even when it is the first thing, and keeps a first heading's paragraph", () => {
    expect(releaseNotesSection("\n## Where your data lives\nfolder", "zip")).toBe("");
    expect(releaseNotesSection("## New\none\n\n## Fixed\ntwo", "zip")).toBe("## New\none\n\n## Fixed\ntwo");
  });

  it("leaves out the Linux section, also when it comes first, except for the AppImage", () => {
    const mid = notes("## New\none\n## Linux\nappimage only\n## Fixed\ntwo");
    expect(releaseNotesSection(mid, "zip")).toBe("## New\none\n\n## Fixed\ntwo");
    expect(releaseNotesSection(notes("## Linux\nappimage only\n## Fixed\ntwo"), "portable")).toBe("## Fixed\ntwo");
    expect(releaseNotesSection("<!-- whats-new -->## Linux\nappimage only\n## Fixed\ntwo<!-- /whats-new -->", "zip")).toBe("## Fixed\ntwo");
    expect(releaseNotesSection(mid, "appimage")).toContain("appimage only");
  });
});

describe("the notes between two versions", () => {
  const list = [
    null,
    rel("v1.9.0", { body: notes("drafted"), draft: true }),
    rel("v1.8.0", { body: notes("pre"), prerelease: true }),
    { tag_name: 3, body: notes("no tag") },
    rel("v1.7.0", { body: notes("past the end") }),
    rel("v1.6.0-zip", { body: notes("six zip"), published_at: 9 }),
    rel("v1.5.5", { body: notes("drafted in range"), draft: true }),
    rel("v1.5.6", { body: notes("pre in range"), prerelease: true }),
    rel("v1.6.0", { body: notes("six exe") }),
    rel("v1.5.0", { body: notes("   ") }),
    rel("v1.4.0", {}),
    rel("bogus", { body: notes("bogus") }),
    rel("v1.3.0-zip", { body: notes("three") }),
    rel("v1.2.0", { body: notes("two") }),
    rel("v1.1.0", { body: notes("one") }),
  ];

  it("lists each release after `from` up to `to`, newest first, skipping drafts, pre-releases and empty notes", () => {
    const n = releaseNotesBetween(list, "1.1.0", "1.6.0", "portable");
    expect(n.map((x) => [x.version, x.notes])).toEqual([
      ["1.6.0", "six exe"],
      ["1.3.0", "three"],
      ["1.2.0", "two"],
    ]);
  });

  it("prefers this form's own page, whichever comes first, and has no date that is not a string", () => {
    const zip = releaseNotesBetween(list, "1.5.0", "1.6.0", "zip")[0]!;
    expect([zip.notes, zip.pageUrl, zip.publishedAt]).toEqual(["six zip", "https://github.com/bahuckel/EDEXO/releases/tag/v1.6.0-zip", null]);
    const exeFirst = [rel("v1.6.0", { body: notes("exe") }), rel("v1.6.0-zip", { body: notes("zip") })];
    expect(releaseNotesBetween(exeFirst, "1.5.0", "1.6.0", "zip")[0]!.notes).toBe("zip");
    // Two of the other form's: the first stays.
    const twoExe = [rel("v1.6.0", { body: notes("first") }), rel("v1.6.0", { body: notes("second") })];
    expect(releaseNotesBetween(twoExe, "1.5.0", "1.6.0", "zip")[0]!.notes).toBe("first");
    expect(releaseNotesBetween(list, "1.5.0", "1.6.0", "portable")[0]!.publishedAt).toBe("2026-11-01T00:00:00Z");
  });

  it("keeps the newest few", () => {
    const many = Array.from({ length: 8 }, (_, i) => rel(`v2.${i}.0`, { body: notes(`n${i}`) }));
    expect(releaseNotesBetween(many, "1.0.0", "3.0.0", "zip").map((x) => x.version)).toEqual(["2.7.0", "2.6.0", "2.5.0", "2.4.0", "2.3.0"]);
    expect(releaseNotesBetween(many, "1.0.0", "3.0.0", "zip", 2)).toHaveLength(2);
  });
});

describe("the checker", () => {
  const list = [rel("v1.3.0", { assets: [exe()] }), rel("v1.3.0-zip")];
  const fetchOf = (body: unknown) => vi.fn(async () => new Response(JSON.stringify(body))) as unknown as typeof fetch;

  it("says nothing before it has asked, dates and all", () => {
    const a = createUpdateChecker({ fetchImpl: fetchOf(list), current: "1.2.0", form: "portable" });
    expect(a.lastError()).toBeNull();
    expect(a.newerAsset()).toBeNull();
    expect(a.notesBetween(null, "1.3.0")).toEqual([]);
  });

  it("asks GitHub's release list as a GitHub client, once while an ask is running", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const f = vi.fn(async (_url: string, _init: RequestInit) => {
      await gate;
      return new Response(JSON.stringify(list));
    });
    const c = createUpdateChecker({ fetchImpl: f as unknown as typeof fetch, current: "1.2.0", form: "portable" });
    const first = c.check();
    const second = c.check(true);
    release();
    await Promise.all([first, second]);
    expect(f).toHaveBeenCalledTimes(1);
    expect(f.mock.calls[0]![0]).toBe(RELEASES_API);
    expect(f.mock.calls[0]![1].headers).toEqual({ Accept: "application/vnd.github+json", "User-Agent": APP_USER_AGENT });
  });

  it("says when GitHub lists no release", async () => {
    const a = await createUpdateChecker({ fetchImpl: fetchOf([]), current: "1.2.0", form: "zip" }).check();
    expect(a).toMatchObject({ latest: null, publishedAt: null, error: "No release found on GitHub" });
  });

  it("asks again at exactly an hour, and the button at exactly a minute", async () => {
    let t = 1_700_000_000_000;
    const f = fetchOf(list);
    const c = createUpdateChecker({ fetchImpl: f, current: "1.2.0", form: "zip", now: () => t });
    await c.check();
    t += 60 * 60 * 1000 - 1;
    await c.check();
    expect(f).toHaveBeenCalledTimes(1);
    t += 1;
    await c.check();
    expect(f).toHaveBeenCalledTimes(2);
    t += 60_000;
    await c.check(true);
    expect(f).toHaveBeenCalledTimes(3);
  });

  it("offers the file only for a newer release that has one, and its notes", async () => {
    const newer = createUpdateChecker({ fetchImpl: fetchOf([rel("v1.3.0", { assets: [exe()], body: notes("three") })]), current: "1.2.0", form: "portable" });
    await newer.check();
    expect(newer.newerAsset()).toMatchObject({ version: "1.3.0", asset: { sha256: HEX } });
    expect(newer.notesBetween("1.2.0", "1.3.0").map((n) => n.notes)).toEqual(["three"]);
    const same = createUpdateChecker({ fetchImpl: fetchOf(list), current: "1.3.0", form: "portable" });
    await same.check();
    expect(same.newerAsset()).toBeNull();
    const noFile = createUpdateChecker({ fetchImpl: fetchOf([rel("v1.3.0")]), current: "1.2.0", form: "portable" });
    await noFile.check();
    expect(noFile.newerAsset()).toBeNull();
  });
});
