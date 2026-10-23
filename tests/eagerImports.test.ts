/**
 * What each window loads before it can draw: the modules a client entry reaches through static imports (a dynamic
 * `import()` starts a chunk of its own and does not count). The load-time audit (2026-10-22) found four static
 * imports that pulled whole screens into windows that never show them; these keep them out.
 *
 * Read from the source, with the same rules the bundler follows for these files: `import type` and imports of types
 * only are erased, `export … from` re-exports count.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "..");
const EXTS = [".ts", ".tsx", ".js"];

function resolveSpec(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@shared/")) base = path.join(ROOT, "src/shared", spec.slice("@shared/".length));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(from), spec);
  else return null; // a package
  const stem = base.replace(/\.js$/, "");
  for (const c of [base, ...EXTS.map((e) => stem + e), ...EXTS.map((e) => path.join(base, "index" + e))]) {
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  return null;
}

/** The static value imports of one file: `import … from`, `import "x"`, `export … from`; not types, not `import()`. */
function staticImports(file: string): string[] {
  if (!/\.(ts|tsx|js)$/.test(file)) return [];
  const src = readFileSync(file, "utf8");
  const out: string[] = [];
  const re = /^(import|export)\s+([^;]*?)\s*from\s+["']([^"']+)["']|^import\s+["']([^"']+)["']/gm;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    if (m[4]) {
      out.push(m[4]);
      continue;
    }
    const clause = m[2]!.trim();
    if (/^type\s/.test(clause)) continue;
    const named = /^\{([\s\S]*)\}$/.exec(clause);
    if (named) {
      const parts = named[1]!.split(",").map((s) => s.trim()).filter(Boolean);
      if (parts.length && parts.every((p) => p.startsWith("type "))) continue;
    }
    out.push(m[3]!);
  }
  return out;
}

function eagerGraph(entry: string): Set<string> {
  const seen = new Set<string>();
  const stack = [path.join(ROOT, entry)];
  while (stack.length) {
    const f = stack.pop()!;
    if (seen.has(f)) continue;
    seen.add(f);
    for (const spec of staticImports(f)) {
      const r = resolveSpec(f, spec);
      if (r) stack.push(r);
    }
  }
  return new Set([...seen].map((f) => path.relative(ROOT, f).replace(/\\/g, "/")));
}

describe("what a window loads up front", () => {
  it("the entry does not carry Compare's App: Colonize, galaxy, map and triage windows never draw it", () => {
    const g = eagerGraph("src/client/main.tsx");
    expect(g.has("src/client/main.tsx")).toBe(true);
    expect(g.has("src/client/App.tsx")).toBe(false);
    expect(g.has("src/client/BodyPane.tsx")).toBe(false);
  });

  it("the Colonize window does not load Compare's App (the legal footer has its own module)", () => {
    for (const entry of ["src/client/colonize/ColonizeScreen.tsx", "src/client/colonize/views/PhoneView.tsx"]) {
      const g = eagerGraph(entry);
      expect(g.has("src/client/AppLegalFooter.tsx"), entry).toBe(true);
      expect(g.has("src/client/App.tsx"), entry).toBe(false);
    }
  });

  it("the header's Next boxel does not bring the galaxy map's Expedition drawer and menus", () => {
    const g = eagerGraph("src/client/App.tsx");
    expect(g.has("src/client/NextBoxelCard.tsx")).toBe(true);
    expect(g.has("src/client/expeditionFocus.ts")).toBe(true);
    expect(g.has("src/client/ExpeditionDrawer.tsx")).toBe(false);
    expect(g.has("src/client/galaxy3d/G3dMenu.tsx")).toBe(false);
  });

  it("Compare's Browser tab does not load Colonize's Inara reader until a page is read", () => {
    const g = eagerGraph("src/client/BrowserScreen.tsx");
    expect(g.has("src/client/tabs/browserOpen.ts")).toBe(true);
    expect(g.has("src/client/colonize/inaraBrowser.ts")).toBe(false);
    expect(g.has("src/client/colonize/api.ts")).toBe(false);
  });

  it("the scanner itself: type-only imports are not followed, value imports are", () => {
    const g = eagerGraph("src/client/colonize/ColonizeScreen.tsx");
    expect(g.has("src/client/colonize/api.ts")).toBe(true);
    // BrowserScreen names InaraPageRead with `import type`.
    expect(staticImports(path.join(ROOT, "src/client/BrowserScreen.tsx"))).not.toContain("./colonize/inaraBrowser");
  });
});
