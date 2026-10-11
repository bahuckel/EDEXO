/**
 * @vitest-environment jsdom
 *
 * A render error stays in the part that threw (owner, 2026-10-11: the Boxels screen went blank on fast
 * scrolling): the boundary shows what went wrong and a button, and the button mounts the part afresh.
 */
import { describe, expect, it, vi } from "vitest";
import { createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { ErrorBoundary } from "../src/client/ui/ErrorBoundary.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let fail = true;
function Flaky() {
  const [n] = useState(() => Math.random());
  if (fail) throw new Error("row height went negative");
  return createElement("p", { id: "ok" }, `drawn ${n > -1 ? "again" : ""}`);
}

describe("error boundary", () => {
  it("shows the error in place and draws the part again on request", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => root.render(createElement("div", null, createElement("h1", null, "Boxels"), createElement(ErrorBoundary, { label: "This table", children: createElement(Flaky) }))));
    expect(host.querySelector("h1")?.textContent).toBe("Boxels");
    expect(host.querySelector("[role=alert]")?.textContent).toContain("This table could not be drawn. row height went negative");
    fail = false;
    await act(async () => (host.querySelector("button") as HTMLButtonElement).click());
    expect(host.querySelector("#ok")?.textContent).toBe("drawn again");
    expect(host.querySelector("[role=alert]")).toBeNull();
    root.unmount();
    quiet.mockRestore();
  });
});
