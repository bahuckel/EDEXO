// @vitest-environment jsdom
/**
 * The 16 px blur under a loading photo (UI ideas 2026-11-16 §4.5): the Encyclopedia's photo asks for its own photo's
 * blur, and the house placeholder, which has none, asks for nothing.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { EncyclopediaThumb } from "../src/client/encyclopedia/EncyclopediaThumb";
import { BUILTIN_PLACEHOLDER_URL } from "../src/shared/photoPlaceholder";

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const thumb = (photoUrl: string) => {
  act(() => root.render(createElement(EncyclopediaThumb, { photoUrl, displayName: "Aleoida arcus", size: "card" })));
  return host.querySelector("img")!;
};

describe("photo blur", () => {
  it("lays the photo's own blur under an Encyclopedia photo", () => {
    const img = thumb("/species-photos/aleoida/Aleoida-arcus.jpg");
    expect(img.getAttribute("src")).toBe("/species-photos/aleoida/Aleoida-arcus.jpg?size=card");
    expect(img.hasAttribute("data-blur")).toBe(true);
    expect(img.style.backgroundImage).toContain("/species-photos/aleoida/Aleoida-arcus.jpg?size=blur");
  });

  it("asks for none under the house placeholder", () => {
    const img = thumb(BUILTIN_PLACEHOLDER_URL);
    expect(img.hasAttribute("data-blur")).toBe(false);
    expect(img.style.backgroundImage).toBe("");
  });
});
