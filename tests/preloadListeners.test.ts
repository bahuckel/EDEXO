/**
 * electron/preload.cjs (code review E): every listener the bridge registers hands back a remover that takes off exactly
 * what it put on, so a page that subscribes again does not stack handlers on the channel.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type Handler = (evt: unknown, v: unknown) => void;
type Api = Record<string, unknown> & { tabs: Record<string, unknown>; browser: Record<string, unknown> };

function loadPreload() {
  const on = new Map<string, Handler[]>();
  let api: Api | null = null;
  const electron = {
    contextBridge: { exposeInMainWorld: (_key: string, value: Api) => (api = value) },
    ipcRenderer: {
      on: (ch: string, h: Handler) => on.set(ch, [...(on.get(ch) ?? []), h]),
      removeListener: (ch: string, h: Handler) => on.set(ch, (on.get(ch) ?? []).filter((x) => x !== h)),
      send: () => {},
      invoke: async () => undefined,
    },
  };
  const src = readFileSync(new URL("../electron/preload.cjs", import.meta.url), "utf8");
  new Function("require", "process", src)(() => electron, { argv: [] });
  const count = () => [...on.values()].reduce((n, hs) => n + hs.length, 0);
  return { api: api!, on, count };
}

describe("preload listeners", () => {
  it("returns a remover from every on… call, which takes its handlers off again", () => {
    const { api, count } = loadPreload();
    const subscribers: [string, (cb: (v: unknown) => void) => unknown][] = [
      ...Object.entries(api).filter(([k, v]) => /^on[A-Z]/.test(k) && typeof v === "function"),
      ["tabs.on", api.tabs.on],
      ["browser.on", api.browser.on],
    ] as [string, (cb: (v: unknown) => void) => unknown][];
    expect(subscribers.map(([k]) => k)).toEqual(
      expect.arrayContaining(["onHudMoveMode", "onHudChainOffers", "onHudVisibility", "onHudPrefs", "onUiCommand"]),
    );
    for (const [name, subscribe] of subscribers) {
      const before = count();
      const off = subscribe(() => {});
      expect(typeof off, name).toBe("function");
      expect(count(), name).toBeGreaterThan(before);
      (off as () => void)();
      expect(count(), name).toBe(before);
    }
  });

  it("hands the message, not the event, to the callback", () => {
    const { api, on } = loadPreload();
    const got: unknown[] = [];
    (api.onHudPrefs as (cb: (v: unknown) => void) => () => void)((v) => got.push(v));
    for (const h of on.get("edexo:hud-prefs")!) h({ sender: "main" }, { scale: 1.2 });
    expect(got).toEqual([{ scale: 1.2 }]);
  });
});
