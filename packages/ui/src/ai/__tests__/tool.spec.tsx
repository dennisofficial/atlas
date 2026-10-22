import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from "react-dom/server";

import { EToolKind, EToolState, Tool, toolTitle } from "../tool";

const render = (state: EToolState, extra: Partial<Parameters<typeof Tool>[0]> = {}) =>
  renderToStaticMarkup(
    <Tool label="git status --short" state={state} output=" M a.ts" errorText="boom" {...extra} />,
  );

describe("Tool", () => {
  it("titles each state in the right tense", () => {
    const title = (state: EToolState) =>
      toolTitle({ kind: EToolKind.Shell, state, label: "pnpm test" });

    expect(title(EToolState.Running)).toBe("Running pnpm test");
    expect(title(EToolState.Done)).toBe("Ran pnpm test");
    expect(title(EToolState.Error)).toBe("Failed to run pnpm test");
    expect(title(EToolState.Denied)).toBe("Denied pnpm test");
    expect(title(EToolState.AwaitingApproval)).toBe("Run pnpm test?");
  });

  it("renders a running line with the running status and no output panel", () => {
    const html = render(EToolState.Running);

    expect(html).toContain('data-status="running"');
    expect(html).toContain("Running git status --short");
    expect(html).not.toContain("trace-collapsible");
  });

  it("renders a done line as a collapsible", () => {
    const html = render(EToolState.Done);

    expect(html).toContain("Ran git status --short");
    expect(html).toContain("trace-collapsible-trigger");
    expect(html).not.toContain(' data-status="');
  });

  it("marks a failed line as an error and opens its error text", () => {
    const html = render(EToolState.Error);

    expect(html).toContain('data-status="error"');
    expect(html).toContain("Failed to run git status --short");
    expect(html).toContain("boom");
  });

  it("renders a denied line without a status", () => {
    const html = render(EToolState.Denied);

    expect(html).toContain("Denied git status --short");
    expect(html).not.toContain(' data-status="');
  });

  it("renders an approval prompt while awaiting approval", () => {
    const html = render(EToolState.AwaitingApproval);

    expect(html).toContain("Run git status --short?");
    expect(html).toContain("Approve");
    expect(html).toContain("Deny");
  });

  it("shows elapsed time next to the title", () => {
    expect(render(EToolState.Done, { elapsed: "1.2s" })).toContain("1.2s");
  });
});
