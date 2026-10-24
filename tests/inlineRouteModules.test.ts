/**
 * The routes that were inline in createHttpServer (audit 2026-10-22: now routes/*Routes.ts), each module on a
 * bare express app: what a build without the feature answers, and the LAN checks of the PC-only routes.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import type { HttpServerOptions, RouteContext } from "../src/server/httpServerTypes.js";
import { catchAsyncRejections } from "../src/server/routes/asyncErrors.js";
import { registerAppInfoRoutes } from "../src/server/routes/appInfoRoutes.js";
import { registerEncyclopediaRoutes } from "../src/server/routes/encyclopediaRoutes.js";
import { registerExoDataRoutes } from "../src/server/routes/exoDataRoutes.js";
import { registerFeederRoutes } from "../src/server/routes/feederRoutes.js";
import { registerLauncherRoutes } from "../src/server/routes/launcherRoutes.js";
import { registerSystemInfoRoutes } from "../src/server/routes/systemInfoRoutes.js";

const ctx: RouteContext = {
  root: ".",
  webRoot: ".",
  pushColonize: () => {},
  watchTopic: () => {},
  topicsMayHaveChanged: () => {},
};
const servers: http.Server[] = [];
afterEach(async () => {
  for (const s of servers.splice(0)) await new Promise((r) => s.close(r));
});

async function serve(
  register: (app: express.Express, opts: HttpServerOptions, ctx: RouteContext) => void,
  opts: Partial<HttpServerOptions> = {},
): Promise<string> {
  const app = express();
  catchAsyncRejections(app);
  app.use(express.json({ limit: "48kb" }));
  register(app, opts as HttpServerOptions, ctx);
  const server = http.createServer(app);
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const post = (url: string, body: unknown) =>
  fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

describe("the routes moved out of createHttpServer", () => {
  it("answer 501 where the build has no such feature", async () => {
    const feeder = await serve(registerFeederRoutes);
    expect((await post(`${feeder}/api/feeder/import-dump`, { file: "x" })).status).toBe(501);
    expect((await fetch(`${feeder}/api/feeder/status`)).status).toBe(501);
    const appInfo = await serve(registerAppInfoRoutes);
    expect((await fetch(`${appInfo}/api/app/update`)).status).toBe(501);
    expect((await fetch(`${appInfo}/api/app/diagnostics`)).status).toBe(501);
    const ency = await serve(registerEncyclopediaRoutes);
    expect((await fetch(`${ency}/api/species-encyclopedia`)).status).toBe(501);
    expect((await fetch(`${ency}/api/encyclopedia-exomastery/a/b`)).status).toBe(501);
    const exo = await serve(registerExoDataRoutes);
    expect((await post(`${exo}/api/exobiology/reset`, { confirm: true })).status).toBe(501);
  });

  it("still pass a rejected async handler to Express, which answers 500", async () => {
    const base = await serve(registerAppInfoRoutes, {
      getUpdateInfo: async () => {
        throw new Error("GitHub is down");
      },
    });
    expect((await fetch(`${base}/api/app/update`)).status).toBe(500);
  });

  it("serve this PC: the launcher's LAN switch checks its body, the status and position are read", async () => {
    const launcher = await serve(registerLauncherRoutes);
    expect((await post(`${launcher}/api/launcher/lan-access`, { enabled: "yes" })).status).toBe(400);
    expect((await post(`${launcher}/api/launcher/open-mode`, { mode: "nope" })).status).toBe(400);
    const info = await serve(registerSystemInfoRoutes, {
      getCommanderPosition: () => ({ x: 1, y: 2, z: 3 }),
      getCommanderSystem: () => "Sol",
      getStatus: () => ({ ok: true }) as never,
    });
    expect(await (await fetch(`${info}/api/commander-position`)).json()).toEqual({
      position: { x: 1, y: 2, z: 3 },
      system: "Sol",
    });
    expect(await (await fetch(`${info}/api/status`)).json()).toEqual({ ok: true });
  });
});
