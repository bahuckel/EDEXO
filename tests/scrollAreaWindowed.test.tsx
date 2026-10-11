/**
 * @vitest-environment jsdom
 *
 * A windowed list's viewport turns scroll anchoring off (owner, 2026-10-11: fast scrolling blanked the Boxels
 * screen): the class that carries `overflow-anchor: none` is on it exactly when it reports its view.
 */
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import { ScrollArea } from "../src/client/ui/ScrollArea.js";

describe("scroll area", () => {
  it("marks a windowed viewport, and the stylesheet turns anchoring off for it", () => {
    const windowed = renderToStaticMarkup(createElement(ScrollArea, { onView: () => {}, children: "rows" }));
    const plain = renderToStaticMarkup(createElement(ScrollArea, { children: "rows" }));
    expect(windowed).toContain("scroll-area__viewport--windowed");
    expect(plain).not.toContain("scroll-area__viewport--windowed");
    const css = readFileSync(path.join(__dirname, "..", "src", "client", "styles", "my-exobiology.css"), "utf8");
    expect(css).toMatch(/\.scroll-area__viewport--windowed\s*\{\s*overflow-anchor:\s*none;/);
  });
});
