/**
 * The pages run under a Content-Security-Policy without 'unsafe-inline' for scripts (Phase 6), so
 * no page may carry an inline script or an `on…=` handler attribute: it would silently not run.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CONTENT_SECURITY_POLICY, contentSecurityPolicyFor } from "../src/server/csp.js";

const pages = [
  ...readdirSync("public")
    .filter((f) => f.endsWith(".html"))
    .map((f) => path.join("public", f)),
  ...readdirSync(path.join("public", "legal"))
    .filter((f) => f.endsWith(".html"))
    .map((f) => path.join("public", "legal", f)),
  // The app and, since 1.2.17, the HUD overlay pages (Vite entries).
  ...readdirSync(path.join("src", "client"))
    .filter((f) => f.endsWith(".html"))
    .map((f) => path.join("src", "client", f)),
];

describe("Content-Security-Policy", () => {
  it("allows scripts from this origin only", () => {
    const script = CONTENT_SECURITY_POLICY.split("; ").find((d) => d.startsWith("script-src"));
    expect(script).toBe("script-src 'self'");
    expect(CONTENT_SECURITY_POLICY).toContain("object-src 'none'");
  });

  it("lets a page open its WebSocket on its own host only (review 2026-11-07 §7)", () => {
    const connect = (csp: string) => csp.split("; ").find((d) => d.startsWith("connect-src"))!.split(" ");
    expect(connect(CONTENT_SECURITY_POLICY)).not.toContain("ws:");
    expect(connect(CONTENT_SECURITY_POLICY)).toContain("ws://127.0.0.1:*");
    const lan = connect(contentSecurityPolicyFor("192.168.1.20:7111"));
    expect(lan).toEqual(expect.arrayContaining(["ws://192.168.1.20:7111", "wss://192.168.1.20:7111"]));
    expect(lan).not.toContain("ws:");
    expect(connect(contentSecurityPolicyFor("[::1]:7111"))).toContain("ws://[::1]:7111");
    // Not a plain host[:port]: the desktop policy, nothing from the header.
    for (const bad of ["evil.com; script-src *", "a b", "", undefined])
      expect(contentSecurityPolicyFor(bad)).toBe(CONTENT_SECURITY_POLICY);
  });

  it.each(pages)("%s has no inline script and no on…= handler", (p) => {
    const html = readFileSync(p, "utf8").replace(/<!--[\s\S]*?-->/g, "");
    const inline = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)].filter(
      (m) => !/\bsrc=/.test(m[1]!) || m[2]!.trim() !== "",
    );
    expect(inline.map((m) => m[0].slice(0, 80))).toEqual([]);
    expect(html.match(/<[^>]+\son[a-z]+\s*=/gi) ?? []).toEqual([]);
  });
});
