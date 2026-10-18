/**
 * The pages' files from disk while the server boots (electron/staticShell.cjs; owner, 2026-10-19: the launcher
 * still drew late, an early app window stayed blank): only files the server would serve itself, with its headers;
 * everything else goes on to the server unchanged.
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
type Handler = (req: Request) => Promise<Response>;
type FakeSession = {
  protocol: { handle(scheme: string, h: Handler): void; unhandle(scheme: string): void };
  fetch(req: Request, opts: { bypassCustomProtocolHandlers: boolean }): Promise<Response>;
};
const { installStaticShell, shellFileFor } = require("../electron/staticShell.cjs") as {
  installStaticShell(o: { sessions: FakeSession[]; baseUrl: string; webRoot: string; csp: string }): {
    remove(): void;
    served(): number;
  };
  shellFileFor(webRoot: string, pathname: string): string | null;
};

let root: string;
beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "edexo-shell-"));
  mkdirSync(path.join(root, "assets"));
  writeFileSync(path.join(root, "index.html"), "<!doctype html><div id=root></div>");
  writeFileSync(path.join(root, "launcher.html"), "<!doctype html>launcher");
  writeFileSync(path.join(root, "assets", "index-abc.js"), "console.log(1)");
  writeFileSync(path.join(root, ".secret.json"), "{}");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("shellFileFor", () => {
  it("maps / to the app and real files to themselves", () => {
    expect(shellFileFor(root, "/")).toBe(path.join(root, "index.html"));
    expect(shellFileFor(root, "/launcher.html")).toBe(path.join(root, "launcher.html"));
    expect(shellFileFor(root, "/assets/index-abc.js")).toBe(path.join(root, "assets", "index-abc.js"));
  });

  it("leaves everything else to the server", () => {
    expect(shellFileFor(root, "/api/status")).toBeNull(); // no type: a route
    expect(shellFileFor(root, "/galaxy")).toBeNull();
    expect(shellFileFor(root, "/.secret.json")).toBeNull(); // dotfiles, as express.static
    expect(shellFileFor(root, "/../outside.html")).toBeNull();
    expect(shellFileFor(root, "/%2e%2e/outside.html")).toBeNull();
    expect(shellFileFor(root, "/assets/..%2f..%2foutside.js")).toBeNull();
    expect(shellFileFor(root, "/%E0%A4%A")).toBeNull(); // bad escape
    expect(shellFileFor(root, "/sound.mp3")).toBeNull(); // unknown type (ranges): the server's
  });
});

describe("installStaticShell", () => {
  function fakeSession() {
    const s = {
      handler: null as Handler | null,
      passed: [] as string[],
      protocol: {
        handle: (_scheme: string, h: Handler) => {
          s.handler = h;
        },
        unhandle: () => {
          s.handler = null;
        },
      },
      fetch: async (req: Request) => {
        s.passed.push(`${req.method} ${req.url}`);
        return new Response("from server", { status: 200 });
      },
    };
    return s;
  }

  it("serves the page with the server's headers and passes the rest on", async () => {
    const ses = fakeSession();
    const shell = installStaticShell({ sessions: [ses], baseUrl: "http://127.0.0.1:7111", webRoot: root, csp: "default-src 'self'" });
    const h = ses.handler!;

    const page = await h(new Request("http://127.0.0.1:7111/launcher.html"));
    expect(await page.text()).toBe("<!doctype html>launcher");
    expect(page.headers.get("content-security-policy")).toBe("default-src 'self'");
    expect(page.headers.get("cache-control")).toContain("no-store");
    expect(page.headers.get("content-type")).toContain("text/html");

    const app = await h(new Request("http://127.0.0.1:7111/?view=galaxy"));
    expect(await app.text()).toContain("id=root");

    const asset = await h(new Request("http://127.0.0.1:7111/assets/index-abc.js"));
    expect(asset.headers.get("cache-control")).toContain("immutable");

    await h(new Request("http://127.0.0.1:7111/api/status"));
    await h(new Request("http://127.0.0.1:7111/missing.js"));
    await h(new Request("http://127.0.0.1:7111/launcher.html", { method: "POST", body: "x" }));
    await h(new Request("http://example.com/index.html"));
    await h(new Request("http://127.0.0.1:7112/index.html"));
    expect(ses.passed).toEqual([
      "GET http://127.0.0.1:7111/api/status",
      "GET http://127.0.0.1:7111/missing.js",
      "POST http://127.0.0.1:7111/launcher.html",
      "GET http://example.com/index.html",
      "GET http://127.0.0.1:7112/index.html",
    ]);
    expect(shell.served()).toBe(3);

    shell.remove();
    expect(ses.handler).toBeNull();
  });
});
