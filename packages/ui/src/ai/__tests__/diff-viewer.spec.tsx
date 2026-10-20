import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { DiffViewer, gutterNumbers, type DiffLine } from "../diff-viewer";

const lines: DiffLine[] = [
  { kind: "context", text: "keep", oldNumber: 1, newNumber: 1 },
  { kind: "remove", text: "old", oldNumber: 2 },
  { kind: "add", text: "new", newNumber: 2 },
  { kind: "gap", text: "12 unchanged lines" },
];

describe("DiffViewer", () => {
  it("renders add, remove and gap rows with their markers", () => {
    const html = renderToStaticMarkup(
      <DiffViewer path="src/a.ts" lines={lines} added={1} removed={1} />,
    );

    expect(html).toContain('data-kind="add"');
    expect(html).toContain('data-kind="remove"');
    expect(html).toContain('data-kind="gap"');
    expect(html).toContain("bg-diff-add");
    expect(html).toContain("bg-diff-remove");
    expect(html).toContain("bg-diff-band");
    expect(html).toContain("12 unchanged lines");
    expect(html).toContain("+1");
    expect(html).toContain("−1");
  });

  it("shows the path and hunk header", () => {
    const html = renderToStaticMarkup(
      <DiffViewer path="src/a.ts" lines={lines} hunk="@@ -1,2 +1,2 @@" />,
    );

    expect(html).toContain("src/a.ts");
    expect(html).toContain("@@ -1,2 +1,2 @@");
  });

  it("omits counts when not given", () => {
    const html = renderToStaticMarkup(<DiffViewer path="a" lines={lines} />);

    expect(html).not.toContain("+1");
  });

  it("numbers inline rows with one gutter and split rows with two", () => {
    const [context, remove, add, gap] = lines as [DiffLine, DiffLine, DiffLine, DiffLine];

    expect(gutterNumbers({ line: add, mode: "inline" })).toEqual(["2"]);
    expect(gutterNumbers({ line: remove, mode: "inline" })).toEqual(["2"]);
    expect(gutterNumbers({ line: context, mode: "split" })).toEqual(["1", "1"]);
    expect(gutterNumbers({ line: remove, mode: "split" })).toEqual(["2", ""]);
    expect(gutterNumbers({ line: add, mode: "split" })).toEqual(["", "2"]);
    expect(gutterNumbers({ line: gap, mode: "split" })).toEqual(["⋯"]);
  });

  it("uses no removed surface utilities", () => {
    const html = renderToStaticMarkup(<DiffViewer path="a" lines={lines} />);

    expect(html).not.toContain("surface-panel");
    expect(html).not.toContain("text-meta");
  });
});
