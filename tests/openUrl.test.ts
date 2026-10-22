/**
 * Opening an address in the browser on Windows (`cmd /c start`): the address goes in quoted, so an `&` in it stays in
 * it (owner, 2026-10-22: the Colonize streamer view opened without its `&view=stream`).
 */
import { describe, expect, it } from "vitest";
import { winStartArgs } from "../src/server/openUrl";

describe("winStartArgs", () => {
  it("quotes the whole address, & and all", () => {
    expect(winStartArgs("http://127.0.0.1:7111/?screen=colonize&view=stream")).toBe(
      '/d /c start "" "http://127.0.0.1:7111/?screen=colonize&view=stream"',
    );
  });
  it("quotes a folder with & in it the same way (Open folder)", () => {
    expect(winStartArgs("C:\\R&D\\inara")).toBe('/d /c start "" "C:\\R&D\\inara"');
  });
  it("cannot be broken out of with a quote", () => {
    expect(winStartArgs('https://x.example/?q="&calc')).toBe('/d /c start "" "https://x.example/?q=%22&calc"');
  });
});
