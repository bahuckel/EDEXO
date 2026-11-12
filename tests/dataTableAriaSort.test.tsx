/**
 * @vitest-environment jsdom
 *
 * The sorted column says so to a screen reader, not only with its caret (review 2026-11-07 §9, plan 7.5).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { Table } from "../src/client/ui/DataTable";

type Row = { a: number; b: string };
const ROWS: Row[] = [
  { a: 1, b: "x" },
  { a: 2, b: "y" },
];

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

const draw = (dir: 1 | -1) =>
  act(() =>
    root.render(
      <Table<Row>
        rows={ROWS}
        columns={[
          { key: "a", label: "A", numeric: true, value: (r) => r.a, render: (r) => String(r.a) },
          { key: "b", label: "B", value: (r) => r.b, render: (r) => r.b },
        ]}
        sort={{ key: "a", dir }}
        onSort={() => {}}
        rowKey={(r) => String(r.a)}
        empty="none"
      />,
    ),
  );

describe("DataTable aria-sort", () => {
  it("marks the sorted column ascending or descending and the others none", () => {
    draw(1);
    const sorts = () => [...host.querySelectorAll("th")].map((th) => th.getAttribute("aria-sort"));
    expect(sorts()).toEqual(["ascending", "none"]);
    draw(-1);
    expect(sorts()).toEqual(["descending", "none"]);
  });
});
