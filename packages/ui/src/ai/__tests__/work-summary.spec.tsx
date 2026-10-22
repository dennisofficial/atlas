import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from "react-dom/server";

import { WorkSummary, workSummaryTitle } from "../work-summary";

describe("workSummaryTitle", () => {
  it("uses the past tense when finished and the present while running", () => {
    expect(workSummaryTitle({ duration: "33m", running: false })).toBe("Worked for 33m");
    expect(workSummaryTitle({ duration: "33m", running: true })).toBe("Working for 33m");
  });
});

describe("WorkSummary", () => {
  it("renders a finished summary collapsed with its step count", () => {
    const html = renderToStaticMarkup(
      <WorkSummary duration="33m" stepCount={12}>
        <span>child step</span>
      </WorkSummary>,
    );

    expect(html).toContain("Worked for 33m");
    expect(html).toContain("12 steps");
    expect(html).toContain("trace-collapsible-trigger");
    expect(html).not.toContain(' data-status="');
    expect(html).not.toContain("child step");
  });

  it("opens and shows the running status while running", () => {
    const html = renderToStaticMarkup(
      <WorkSummary duration="2m" running>
        <span>child step</span>
      </WorkSummary>,
    );

    expect(html).toContain("Working for 2m");
    expect(html).toContain('data-status="running"');
    expect(html).toContain("child step");
  });

  it("honours defaultOpen over the running default", () => {
    const html = renderToStaticMarkup(
      <WorkSummary duration="33m" defaultOpen>
        <span>child step</span>
      </WorkSummary>,
    );

    expect(html).toContain("child step");
  });

  it("singularises a single step", () => {
    const html = renderToStaticMarkup(
      <WorkSummary duration="1m" stepCount={1}>
        <span>only</span>
      </WorkSummary>,
    );

    expect(html).toContain("1 step<");
  });
});
