import { parseColor } from "@opentui/core";
import { testRender } from "@opentui/react/test-utils";
import { describe, expect, it } from "bun:test";
import React, { act } from "react";

import { IDLE_SIDEBAR, type SidebarModel } from "../../store/sidebar-model";
import { BackPill } from "../components/back-pill";
import { HeadSection } from "../components/sidebar/head";
import { teardown } from "../markdown/__tests__/harness";
import { theme } from "../theme";

const WIDTH = 40;

const HEIGHT = 8;

const ARROW = "←";

type Colour = { equals: (other: unknown) => boolean };

type Painted = { text: string; fg: Colour; bg: Colour };

type Spans = { lines: ({ spans: Painted[] } | undefined)[] };

const paintedAt = (spans: Spans, row: number, cell: number): Painted | undefined => {
  let column = 0;
  for (const span of spans.lines[row]?.spans ?? []) {
    const width = [...span.text].length;
    if (cell < column + width) return span;
    column += width;
  }
  return undefined;
};

const mount = async (
  node: React.ReactNode,
): Promise<Awaited<ReturnType<typeof testRender>>> =>
  testRender(
    <box flexDirection="column" width={WIDTH} height={HEIGHT}>
      {node}
    </box>,
    { width: WIDTH, height: HEIGHT },
  );

describe("the back pill", () => {
  it("draws the arrow and the label in the agent accent", async () => {
    const setup = await mount(<BackPill label="dana's session" onBack={() => undefined} />);

    try {
      await setup.flush();
      const frame = setup.captureCharFrame();
      expect(frame).toContain(`${ARROW} dana's session`);

      const spans = setup.captureSpans() as unknown as Spans;
      const row = frame.split("\n").findIndex((line) => line.includes(ARROW));
      expect(paintedAt(spans, row, frame.split("\n")[row]?.indexOf(ARROW) ?? 0)?.fg.equals(
        parseColor(theme.court.external),
      )).toBe(true);
    } finally {
      await teardown(setup);
    }
  }, 30_000);

  it("truncates the label to the cells it is given", async () => {
    const setup = await mount(
      <BackPill label="a teammate with a very long name" onBack={() => undefined} cells={10} />,
    );

    try {
      await setup.flush();
      const frame = setup.captureCharFrame();

      expect(frame).toContain("a teammat…");
      expect(frame).not.toContain("teammate");
    } finally {
      await teardown(setup);
    }
  }, 30_000);

  it("calls onBack when it is pressed", async () => {
    const presses: string[] = [];
    const setup = await mount(<BackPill label="back" onBack={() => presses.push("back")} />);

    try {
      await setup.flush();
      const rows = setup.captureCharFrame().split("\n");
      const row = rows.findIndex((line) => line.includes("back"));
      const column = (rows[row] ?? "").indexOf(ARROW);

      expect(row).toBeGreaterThanOrEqual(0);

      await act(async () => {
        await setup.mockMouse.click(column, row);
      });
      await setup.flush();

      expect(presses).toEqual(["back"]);
    } finally {
      await teardown(setup);
    }
  }, 30_000);

  it("washes the row with the hover background while the pointer is over it", async () => {
    const setup = await mount(<BackPill label="back" onBack={() => undefined} />);

    try {
      await setup.flush();
      const rows = setup.captureCharFrame().split("\n");
      const row = rows.findIndex((line) => line.includes("back"));
      const column = (rows[row] ?? "").indexOf("back");

      expect(row).toBeGreaterThanOrEqual(0);

      const before = setup.captureSpans() as unknown as Spans;
      expect(
        paintedAt(before, row, column)?.bg.equals(parseColor(theme.hoverBg)),
      ).toBe(false);

      await act(async () => {
        await setup.mockMouse.moveTo(column, row);
      });
      await setup.flush();

      const lit = setup.captureSpans() as unknown as Spans;
      expect(paintedAt(lit, row, column)?.bg.equals(parseColor(theme.hoverBg))).toBe(
        true,
      );
    } finally {
      await teardown(setup);
    }
  }, 30_000);
});

describe("the accented head", () => {
  const NAMED: SidebarModel = { ...IDLE_SIDEBAR, title: "dana's session" };

  it("paints the settled title in the agent accent when accented", async () => {
    const setup = await mount(<HeadSection model={NAMED} cells={WIDTH} accented />);

    try {
      await setup.flush();
      const rows = setup.captureCharFrame().split("\n");
      const row = rows.findIndex((line) => line.includes("dana's session"));
      const column = (rows[row] ?? "").indexOf("dana's session");

      expect(row).toBeGreaterThanOrEqual(0);

      const spans = setup.captureSpans() as unknown as Spans;
      expect(
        paintedAt(spans, row, column)?.fg.equals(parseColor(theme.court.external)),
      ).toBe(true);
    } finally {
      await teardown(setup);
    }
  }, 30_000);

  it("keeps the title bright when it is not accented", async () => {
    const setup = await mount(<HeadSection model={NAMED} cells={WIDTH} />);

    try {
      await setup.flush();
      const rows = setup.captureCharFrame().split("\n");
      const row = rows.findIndex((line) => line.includes("dana's session"));
      const column = (rows[row] ?? "").indexOf("dana's session");

      expect(row).toBeGreaterThanOrEqual(0);

      const spans = setup.captureSpans() as unknown as Spans;
      expect(
        paintedAt(spans, row, column)?.fg.equals(parseColor(theme.bright)),
      ).toBe(true);
    } finally {
      await teardown(setup);
    }
  }, 30_000);
});
