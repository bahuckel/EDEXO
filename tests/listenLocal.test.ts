/** The test servers' port (tests/helpers/listenLocal.ts): never one fetch() refuses. */
import http from "node:http";
import { describe, expect, it } from "vitest";
import { listenLocal } from "./helpers/listenLocal.js";

describe("listenLocal", () => {
  it("listens again when the port drawn is one fetch refuses", async () => {
    let listens = 0;
    const target = {
      listen(port: number, host: string) {
        const s = http.createServer((_req, res) => res.end("ok")).listen(port, host);
        if (listens++ === 0) s.address = () => ({ port: 6000, family: "IPv4", address: host });
        return s;
      },
    };
    const { server, base } = await listenLocal(target);
    try {
      expect(listens).toBe(2);
      expect(Number(new URL(base).port)).toBeGreaterThan(10080);
      expect(await (await fetch(base)).text()).toBe("ok");
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
});
