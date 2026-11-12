/** Plan 2026-11-10 Phase 7.4: the client's request helpers and the server's error answer are the idioms they replaced. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { jsonOrNull, jsonOrThrow, sendJson } from "../src/client/http.js";
import { errorText, fail } from "../src/server/errorText.js";

afterEach(() => vi.unstubAllGlobals());

describe("client request helpers", () => {
  it("sendJson posts the body as JSON; init can change the method and add headers", async () => {
    const fetchMock = vi.fn(async () => new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);
    await sendJson("/api/x", { a: 1 });
    expect(fetchMock).toHaveBeenLastCalledWith("/api/x", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: '{"a":1}',
    });
    await sendJson("/api/y", [2], { method: "PUT", headers: { "X-K": "v" } });
    expect(fetchMock).toHaveBeenLastCalledWith("/api/y", {
      method: "PUT",
      headers: { "Content-Type": "application/json", "X-K": "v" },
      body: "[2]",
    });
  });

  it("jsonOrNull: the JSON, or null for an error status; jsonOrThrow rejects with the status", async () => {
    expect(await jsonOrNull<{ a: number }>(new Response('{"a":1}'))).toEqual({ a: 1 });
    expect(jsonOrNull(new Response("nope", { status: 404 }))).toBeNull();
    expect(await jsonOrThrow(new Response("[3]"))).toEqual([3]);
    await expect(jsonOrThrow(new Response("", { status: 503 }))).rejects.toThrow("503");
  });
});

describe("server error answer", () => {
  it("errorText reads an Error's message, anything else as a string; fail answers 500 { ok: false, error }", () => {
    expect(errorText(new Error("disk full"))).toBe("disk full");
    expect(errorText("plain")).toBe("plain");
    const json = vi.fn();
    const res = { status: vi.fn(() => ({ json })) };
    fail(res as never, new Error("boom"));
    expect(res.status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({ ok: false, error: "boom" });
  });
});
