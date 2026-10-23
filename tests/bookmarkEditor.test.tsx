// @vitest-environment jsdom
/**
 * The bookmark editor when the server cannot be reached (audit 2026-10-22): a failed save left the Save button
 * disabled until the editor was closed, and a failed Remove neither closed nor said anything, with an unhandled
 * rejection behind both. Now the button works again and the editor says what did not happen.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { BookmarkDTO } from "../src/shared/bookmarks";
import { BookmarkButton, BookmarkEditor, removeBookmark } from "../src/client/BookmarkButton";

class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

let root: Root | null = null;
let host: HTMLDivElement;
/** What the next POST / DELETE does: "fail" rejects as a dropped connection does, "ok" answers. */
let write: "fail" | "ok" = "fail";

const existing: BookmarkDTO = {
  id: "bm1",
  system: "Smoke Colony",
  systemAddress: 1,
  body: null,
  bodyKey: null,
  tags: ["Biology"],
  note: "",
  createdAt: "2026-10-22T10:00:00Z",
  updatedAt: "2026-10-22T10:00:00Z",
  pos: null,
};

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  write = "fail";
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: { method?: string }) => {
      const method = init?.method ?? "GET";
      if (method === "GET") return { ok: true, json: async () => ({ items: [], customTags: [] }) };
      if (write === "fail") throw new TypeError("Failed to fetch");
      return { ok: true, json: async () => ({ ok: true, bookmark: existing }) };
    }),
  );
  document.body.innerHTML = "";
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  vi.unstubAllGlobals();
});

const flush = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))));
const button = (text: string) =>
  [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === text);
const alertText = () => document.querySelector('[role="alert"]')?.textContent ?? null;

describe("the bookmark editor, server away", () => {
  it("a failed save enables Save again and says so; the next one saves", async () => {
    const onSaved = vi.fn();
    act(() =>
      root!.render(
        createElement(BookmarkEditor, {
          initial: { system: "Smoke Colony", systemAddress: 1 },
          bodies: [],
          onSaved,
          onCancel: () => undefined,
        }),
      ),
    );
    await flush();
    await act(async () => button("Bookmark")!.click());
    await flush();
    expect(button("Bookmark")!.disabled).toBe(false);
    expect(alertText()).toContain("Could not save the bookmark");
    expect(onSaved).not.toHaveBeenCalled();
    write = "ok";
    await act(async () => button("Bookmark")!.click());
    await flush();
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(alertText()).toBeNull();
  });

  it("a failed Remove keeps the editor open and says so; the next one removes and closes", async () => {
    act(() => root!.render(createElement(BookmarkButton, { system: "Smoke Colony", systemAddress: 1, existing })));
    await act(async () => document.querySelector<HTMLButtonElement>(".bm-star")!.click());
    await flush();
    expect(button("Remove bookmark")).toBeTruthy();
    await act(async () => button("Remove bookmark")!.click());
    await flush();
    expect(button("Remove bookmark")).toBeTruthy();
    expect(alertText()).toContain("Could not remove the bookmark");
    write = "ok";
    await act(async () => button("Remove bookmark")!.click());
    await flush();
    expect(button("Remove bookmark")).toBeUndefined();
  });

  it("removeBookmark answers false instead of throwing", async () => {
    await expect(removeBookmark("bm1")).resolves.toBe(false);
  });
});
