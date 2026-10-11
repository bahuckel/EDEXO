/**
 * @vitest-environment jsdom
 *
 * The Boxels screen's "Show Next boxel in the main screen" (owner, 2026-10-11): on unless switched off,
 * remembered, and announced so the header in this window follows at once.
 */
import { describe, expect, it } from "vitest";
import { readNextBoxelInHeader, writeNextBoxelInHeader } from "../src/client/nextBoxelSetting.js";

describe("Next boxel in the header", () => {
  it("is on by default, remembers off, and tells this window", () => {
    localStorage.clear();
    expect(readNextBoxelInHeader()).toBe(true);
    const heard: boolean[] = [];
    window.addEventListener("edexo:next-boxel-in-header", (e) => heard.push((e as CustomEvent<boolean>).detail));
    writeNextBoxelInHeader(false);
    expect(readNextBoxelInHeader()).toBe(false);
    writeNextBoxelInHeader(true);
    expect(readNextBoxelInHeader()).toBe(true);
    expect(heard).toEqual([false, true]);
  });
});
