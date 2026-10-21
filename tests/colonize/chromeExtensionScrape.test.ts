import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The Chrome helper lives outside `src/`, but nothing else runs in CI, so its one security-
 * critical file is exercised from here.
 *
 * What is being pinned: the helper no longer keeps a `FileSystemDirectoryHandle` in IndexedDB.
 * A content script shares its origin's storage with the page, so that handle sat in inara.cz's
 * own database — any script on inara.cz could take it and write into the folder this app
 * watches and imports without a commander ever seeing the file. Saving now goes through the
 * service worker and `chrome.downloads`, which cannot leave the browser download directory,
 * and the filename is rebuilt there rather than taken from the page.
 */
const extDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../chrome-extension");
const read = (name: string) => readFileSync(path.join(extDir, name), "utf8");

type Download = { url: string; filename: string; conflictAction?: string; saveAs?: boolean };
type Listener = (
  msg: unknown,
  sender: { id?: string; url?: string },
  respond: (r: unknown) => void,
) => boolean | undefined;

function loadBackground(): { listener: Listener; downloads: Download[] } {
  const downloads: Download[] = [];
  let listener: Listener | null = null;
  const chrome = {
    runtime: {
      id: "edexo-test-id",
      getManifest: () => ({ version: "9.9.9" }),
      onMessage: {
        addListener: (fn: Listener) => {
          listener = fn;
        },
      },
    },
    downloads: {
      download: (opts: Download) => {
        downloads.push(opts);
        return Promise.resolve(1);
      },
    },
    storage: { local: { set: () => Promise.resolve() } },
  };
  new Function("chrome", read("background.js"))(chrome);
  if (!listener) throw new Error("background.js registered no message listener");
  return { listener, downloads };
}

const station = { systemName: "Examplia AB-C d1-2", stationName: "Hub", distanceLy: 0, supply: 900, buyPrice: 220 };
const payload = {
  version: 1,
  source: "inara",
  nearSystem: "Examplia AB-C d1-2",
  commodityLabel: "CMM Composite",
  stations: [station],
};

/** Drive the listener the way Chrome does and wait for its async reply. */
function send(
  listener: Listener,
  msg: unknown,
  sender: { id?: string; url?: string },
): Promise<unknown | "no-reply"> {
  return new Promise((resolve) => {
    const kept = listener(msg, sender, resolve);
    if (kept !== true) resolve("no-reply");
  });
}

const fromInara = { id: "edexo-test-id", url: "https://inara.cz/elite/commodities/?pa1[]=1" };

describe("the Chrome helper's save path", () => {
  it("writes inside the download folder, under a name it builds itself", async () => {
    const { listener, downloads } = loadBackground();
    const res = (await send(listener, { type: "edexo-save-scrape", payload }, fromInara)) as {
      ok: boolean;
      fileName: string;
    };

    expect(res.ok).toBe(true);
    expect(downloads).toHaveLength(1);
    const dl = downloads[0]!;
    expect(dl.filename.startsWith("EdexoColonize/inara/")).toBe(true);
    expect(dl.filename).toContain("cmm-composite__examplia-ab-c-d1-2__");
    expect(dl.filename.endsWith(".json")).toBe(true);
    expect(dl.conflictAction).toBe("uniquify");
    expect(dl.saveAs).toBe(false);

    const json = JSON.parse(
      Buffer.from(dl.url.replace("data:application/json;base64,", ""), "base64").toString("utf8"),
    ) as { source: string; addonVersion: string; stations: unknown[] };
    expect(json.source).toBe("inara");
    expect(json.addonVersion).toBe("9.9.9");
    expect(json.stations).toHaveLength(1);
  });

  it("cannot be walked out of that folder by what the page says the commodity is", async () => {
    const { listener, downloads } = loadBackground();
    await send(
      listener,
      {
        type: "edexo-save-scrape",
        fileName: "../../../evil.json",
        payload: { ...payload, commodityLabel: "../../../etc/passwd", nearSystem: String.raw`..\..\windows` },
      },
      fromInara,
    );
    const name = downloads[0]!.filename;
    expect(name.startsWith("EdexoColonize/inara/")).toBe(true);
    expect(name).not.toContain("..");
    expect(name.slice("EdexoColonize/inara/".length)).not.toContain("/");
    expect(name).not.toContain("\\");
  });

  it("refuses a message that did not come from inara.cz", async () => {
    const { listener, downloads } = loadBackground();
    const res = (await send(listener, { type: "edexo-save-scrape", payload }, {
      id: "edexo-test-id",
      url: "https://evil.example/page",
    })) as { ok: boolean };
    expect(res.ok).toBe(false);
    expect(downloads).toHaveLength(0);
  });

  it("ignores a message from another extension", async () => {
    const { listener, downloads } = loadBackground();
    const res = await send(listener, { type: "edexo-save-scrape", payload }, {
      id: "some-other-extension",
      url: "https://inara.cz/elite/commodities/",
    });
    expect(res).toBe("no-reply");
    expect(downloads).toHaveLength(0);
  });

  it("refuses anything that is not a buy-search result", async () => {
    const { listener, downloads } = loadBackground();
    for (const bad of [
      null,
      { source: "not-inara", nearSystem: "a", commodityLabel: "b", stations: [station] },
      { source: "inara", nearSystem: "", commodityLabel: "b", stations: [station] },
      { source: "inara", nearSystem: "a", commodityLabel: "b", stations: [] },
    ]) {
      const res = (await send(listener, { type: "edexo-save-scrape", payload: bad }, fromInara)) as {
        ok: boolean;
      };
      expect(res.ok).toBe(false);
    }
    expect(downloads).toHaveLength(0);
  });
});

describe("the Chrome helper's manifest and content script", () => {
  it("keeps no directory handle and opens no picker", () => {
    const content = read("content.js");
    expect(content).not.toMatch(/indexedDB/);
    expect(content).not.toMatch(/showDirectoryPicker/);
    expect(content).not.toMatch(/createWritable/);
  });

  it("reads its version from the manifest instead of a literal", () => {
    expect(read("content.js")).toContain("chrome.runtime.getManifest().version");
    expect(read("content.js")).not.toMatch(/addonVersion:\s*"/);
  });

  it("asks for no host permissions and no more than it uses", () => {
    const manifest = JSON.parse(read("manifest.json")) as {
      permissions: string[];
      host_permissions?: string[];
    };
    expect(manifest.host_permissions).toBeUndefined();
    expect([...manifest.permissions].sort()).toEqual(["downloads", "storage"]);
  });
});
