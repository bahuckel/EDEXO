// @vitest-environment jsdom
/**
 * The HUD readers read only the game (review 2026-11-10 E3): nothing while another program is in front (Electron's
 * foreground watcher tells the page), and never another monitor's screen when the game's is not among the sources.
 */
import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readEvery, setGameInFront } from "../src/client/aim/readerThread";

const require = createRequire(import.meta.url);
const { gameSource } = require("../electron/aimWindow.cjs") as {
  gameSource: (s: { display_id: string; id: string }[], want: string) => { id: string } | undefined;
};

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("the readers' loop", () => {
  it("reads four times a second with the game in front and skips every frame with another program there", async () => {
    vi.useFakeTimers();
    const read = vi.fn(async () => {});
    const t = readEvery(250, read);
    await vi.advanceTimersByTimeAsync(1000);
    expect(read).toHaveBeenCalledTimes(4);
    setGameInFront(false);
    await vi.advanceTimersByTimeAsync(2000);
    expect(read).toHaveBeenCalledTimes(4);
    setGameInFront(true);
    await vi.advanceTimersByTimeAsync(250);
    expect(read).toHaveBeenCalledTimes(5);
    clearInterval(t);
  });
});

describe("the capture source", () => {
  const two = [
    { display_id: "1", id: "screen:1" },
    { display_id: "2", id: "screen:2" },
  ];
  it("is the game's monitor", () => {
    expect(gameSource(two, "2")?.id).toBe("screen:2");
  });
  it("is nothing when the game's monitor is not listed among several, the only screen when there is one", () => {
    expect(gameSource(two, "9")).toBeUndefined();
    expect(gameSource([{ display_id: "", id: "screen:0" }], "9")?.id).toBe("screen:0");
  });
});
