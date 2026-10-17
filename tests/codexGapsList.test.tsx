/**
 * @vitest-environment jsdom
 *
 * The galaxy map's codex gaps list (1.2.19; owner, 2026-10-17): folded until opened, and a click asks for the nearest
 * system IN THAT REGION and flies there.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { CodexGapsList } from "../src/client/CodexGapsList";

let host: HTMLDivElement;
let root: Root;
const calls: string[] = [];

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  calls.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      calls.push(url);
      const body = url.startsWith("/api/codex/gaps")
        ? { region: "Inner Orion Spur", known: 3, logged: 1, gaps: [{ key: "codex_ent_aleoids_01_w", name: "Aleoida Arcus - Grey", regionSystems: 1, galaxySystems: 1 }] }
        : { systemAddress: "82931877060", name: "HIP 53274", x: 716, y: -1, z: 244, distanceLy: 757, known: 1, complete: true };
      return { ok: true, json: async () => body } as Response;
    }),
  );
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
const flush = () => act(async () => {});

describe("codex gaps list", () => {
  it("is folded until opened; a click asks for the nearest in that region from the ship and flies there", async () => {
    const onPick = vi.fn();
    act(() => root.render(<CodexGapsList region="Inner Orion Spur" from={{ x: 10, y: 20, z: 30 }} onPick={onPick} />));
    await flush();
    expect(host.querySelectorAll("li")).toHaveLength(0);
    act(() => host.querySelector<HTMLButtonElement>('button[aria-expanded="false"]')!.click());
    const row = [...host.querySelectorAll<HTMLButtonElement>("li button")].find((b) => /Aleoida Arcus - Grey/.test(b.textContent ?? ""))!;
    act(() => row.click());
    await flush();
    expect(calls.at(-1)).toBe("/api/codex/nearest?region=Inner%20Orion%20Spur&key=codex_ent_aleoids_01_w&x=10&y=20&z=30");
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ name: "HIP 53274" }));
    expect(host.querySelector('[role="status"]')?.textContent).toMatch(/nearest in Inner Orion Spur is HIP 53274.*757 ly.*the nearest of the 1 system it is logged in there/);
  });
});
