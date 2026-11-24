// @vitest-environment jsdom
/**
 * A list the socket leaves out, fetched while shown (src/client/useLazyList.ts; UI ideas 2026-11-16 §4.7): once on
 * open, again when its stamp moves, not on a later open while the stamp stands.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useLazyList } from "../src/client/useLazyList";

let root: Root;
let host: HTMLDivElement;
let calls: string[];
let serverItems: string[];
let shown: string[] | null = null;

function Probe({ version, active }: { version: string; active: boolean }) {
  shown = useLazyList<string>("/api/list", "items", version, active);
  return null;
}

const flush = async () => {
  for (let i = 0; i < 5; i++) await act(async () => await Promise.resolve());
};
const render = async (version: string, active: boolean) => {
  await act(async () => root.render(createElement(Probe, { version, active })));
  await flush();
};

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  calls = [];
  serverItems = ["a"];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      calls.push(url);
      return new Response(JSON.stringify({ items: serverItems }), { headers: { "Content-Type": "application/json" } });
    }),
  );
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  shown = null;
});

describe("useLazyList", () => {
  it("waits until shown, fetches once, and again only when the stamp moves", async () => {
    await render("v1", false);
    expect(calls).toEqual([]);
    expect(shown).toBeNull();

    await render("v1", true);
    expect(calls).toEqual(["/api/list"]);
    expect(shown).toEqual(["a"]);

    // Closed and opened again with the same stamp: the list held is still right.
    await render("v1", false);
    await render("v1", true);
    expect(calls).toHaveLength(1);

    // A scan changed it while shown.
    serverItems = ["a", "b"];
    await render("v2", true);
    expect(calls).toHaveLength(2);
    expect(shown).toEqual(["a", "b"]);

    // Changed while hidden: fetched on the next open, not before.
    serverItems = ["c"];
    await render("v3", false);
    expect(calls).toHaveLength(2);
    await render("v3", true);
    expect(calls).toHaveLength(3);
    expect(shown).toEqual(["c"]);
  });
});
