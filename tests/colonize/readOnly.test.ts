/** Which pages are the read-only phone view (api.ts `colonizeReadOnly`): any address but this PC's own, or `&phone=1`. */
import { describe, expect, it } from "vitest";
import { colonizeReadOnly } from "../../src/client/colonize/api";

describe("colonizeReadOnly", () => {
  it("is false on this PC and true from the LAN or with phone=1", () => {
    for (const hostname of ["127.0.0.1", "localhost", "LOCALHOST", "app.localhost", "[::1]"]) expect(colonizeReadOnly({ hostname, search: "" }), hostname).toBe(false);
    for (const hostname of ["192.0.2.10", "10.0.0.2", "my-pc.lan", "edexo.example.com"]) expect(colonizeReadOnly({ hostname, search: "?k=x" }), hostname).toBe(true);
    expect(colonizeReadOnly({ hostname: "127.0.0.1", search: "?screen=colonize&phone=1" })).toBe(true);
  });
});
