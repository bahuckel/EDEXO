/**
 * The server's stdio transport (Tauri test shell, docs/plan-25102026-tauri-1.4.0.md phase 0): the same messages as
 * Electron's utility-process port, one JSON object per line; stdout lines carry a prefix, stdin closing stops it.
 */
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { STDIO_MESSAGE_PREFIX, stdioPort } from "../src/server/serverChild.js";

describe("the server's stdio port", () => {
  it("reads one message per line, across chunks, and skips what is not JSON", () => {
    const input = new PassThrough();
    const got: unknown[] = [];
    stdioPort(input, () => {}).on("message", (e) => got.push(e.data));
    input.write('{"type":"start","mode":"server","ar');
    input.write('gv":[]}\r\nnot json\n\n{"type":"call","id":1,"method":"flushNow","args":[]}\n');
    expect(got).toEqual([
      { type: "start", mode: "server", argv: [] },
      { type: "call", id: 1, method: "flushNow", args: [] },
    ]);
  });

  it("writes each message as one prefixed line", () => {
    const lines: string[] = [];
    stdioPort(new PassThrough(), (l) => lines.push(l)).postMessage({ type: "started", baseUrl: "http://127.0.0.1:7111" });
    expect(lines).toEqual([`${STDIO_MESSAGE_PREFIX}{"type":"started","baseUrl":"http://127.0.0.1:7111"}\n`]);
  });

  it("treats stdin closing as a shutdown", () => {
    const input = new PassThrough();
    const got: unknown[] = [];
    stdioPort(input, () => {}).on("message", (e) => got.push(e.data));
    input.end();
    return new Promise<void>((resolve) =>
      setImmediate(() => {
        expect(got).toEqual([{ type: "shutdown" }]);
        resolve();
      }),
    );
  });
});
