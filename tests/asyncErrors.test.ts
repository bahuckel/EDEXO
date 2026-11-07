/**
 * A route's error answers JSON with no detail (review 2026-11-07): Express's own page carried the stack and the
 * install's absolute paths to LAN clients.
 */
import { afterEach, describe, expect, it } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { answerErrorsAsJson, catchAsyncRejections } from "../src/server/routes/asyncErrors.js";

let server: http.Server | null = null;

async function serve(): Promise<string> {
  const app = express();
  app.disable("x-powered-by");
  catchAsyncRejections(app);
  app.use(express.json({ limit: "1kb" }));
  app.get("/boom", async () => {
    throw new Error("ENOENT: no such file, open '/home/someone/Users/secret.bin'");
  });
  app.post("/echo", (req, res) => res.json(req.body));
  answerErrorsAsJson(app);
  server = http.createServer(app);
  await new Promise<void>((r) => server!.listen(0, "127.0.0.1", () => r()));
  return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
}

afterEach(async () => {
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  server = null;
});

describe("route errors", () => {
  it("answer a rejected handler with JSON 500, no stack, no path", async () => {
    const base = await serve();
    const errors: unknown[] = [];
    const orig = console.error;
    console.error = (...a: unknown[]) => void errors.push(a);
    try {
      const res = await fetch(`${base}/boom`);
      expect(res.status).toBe(500);
      expect(res.headers.get("content-type")).toMatch(/json/);
      expect(res.headers.get("x-powered-by")).toBeNull();
      const text = await res.text();
      expect(JSON.parse(text)).toEqual({ error: "internal" });
      expect(text).not.toMatch(/Users|secret|at /);
    } finally {
      console.error = orig;
    }
    expect(errors.length).toBe(1);
  });

  it("keep a client error's status (a body that is not JSON) without detail", async () => {
    const base = await serve();
    const res = await fetch(`${base}/echo`, { method: "POST", headers: { "content-type": "application/json" }, body: "{nope" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "bad request" });
  });
});
