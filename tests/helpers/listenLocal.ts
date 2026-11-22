import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

/*
  listen(0) on 127.0.0.1, again while the port drawn is one fetch() refuses ("bad port", the Fetch standard's blocked
  ports, all at or below 10080). Windows can hand those out: WinNAT moves the dynamic range down to 1024 (the owner's
  PC, 2026-11-23), and a route test failed with "bad port" about once in sixty full runs.
*/
export async function listenLocal(target: { listen(port: number, host: string): Server }): Promise<{ server: Server; base: string }> {
  for (;;) {
    const server = target.listen(0, "127.0.0.1");
    await new Promise<void>((resolve, reject) => {
      server.once("listening", () => resolve());
      server.once("error", reject);
    });
    const port = (server.address() as AddressInfo).port;
    if (port > 10080) return { server, base: `http://127.0.0.1:${port}` };
    await new Promise<void>((r) => server.close(() => r()));
  }
}
