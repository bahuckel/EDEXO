/**
 * @vitest-environment jsdom
 *
 * The unread count sits beside the bell, not inside it (owner, 2026-10-11): the cockpit's cut-corner
 * buttons carry a clip-path, and a badge inside the button was clipped to its square, so most numbers
 * could not be read. Outside the button it overhangs the corner and still lets clicks through.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { NoticesBell } from "../src/client/NoticesBell";
import { UiFeedbackProvider } from "../src/client/ui/feedback";
import type { AppSnapshot } from "../src/shared/types";

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("notices badge", () => {
  it("is a sibling of the clipped button, carrying the unread count", () => {
    const items = Array.from({ length: 20 }, (_, i) => ({ id: `n${i}`, read: false, kind: "test", title: `t${i}`, at: "2026-10-11T00:00:00Z" }));
    const snap = { notices: { items, recordMarks: [] } } as unknown as AppSnapshot;
    act(() =>
      root.render(
        <UiFeedbackProvider>
          <NoticesBell snap={snap} />
        </UiFeedbackProvider>,
      ),
    );
    const badge = host.querySelector(".exo-data-alerts-trigger__badge");
    expect(badge?.textContent).toBe("20");
    expect(badge?.closest("button")).toBeNull();
    expect(badge?.parentElement?.classList.contains("exo-data-alerts-header-wrap")).toBe(true);
  });
});
