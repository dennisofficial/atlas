import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from "react-dom/server";

import {
  EBootStepState,
  SandboxBoot,
  sandboxBootSummary,
  sandboxBootTitle,
  type SandboxBootProps,
  type SandboxBootStep,
} from "../sandbox-boot";

const CLONE_ERROR = "Repository not found, or the GitHub connection cannot read it.";

const steps = (states: EBootStepState[]): SandboxBootStep[] =>
  states.map((state, index) => ({
    id: `step-${index}`,
    label: `Step label ${index}`,
    state,
    detail: state === EBootStepState.Error ? CLONE_ERROR : `detail ${index}`,
  }));

const { Pending, Running, Done, Error } = EBootStepState;

const render = (props: Partial<SandboxBootProps> = {}) =>
  renderToStaticMarkup(
    <SandboxBoot
      steps={steps([Done, Running, Pending])}
      state={Running}
      elapsedMs={4400}
      {...props}
    />,
  );

describe("sandboxBootTitle", () => {
  it("titles each state", () => {
    expect(sandboxBootTitle(Running)).toBe("Starting sandbox");
    expect(sandboxBootTitle(Done)).toBe("Sandbox ready");
    expect(sandboxBootTitle(Error)).toBe("Sandbox failed to start");
    expect(sandboxBootTitle(Pending)).toBe("Waiting for sandbox");
  });
});

describe("sandboxBootSummary", () => {
  const list = steps([Done, Running, Pending]);

  it("counts finished steps and elapsed seconds while running", () => {
    expect(sandboxBootSummary({ steps: list, state: Running, elapsedMs: 4400 })).toBe("1/3 · 4.4s");
    expect(sandboxBootSummary({ steps: list, state: Running })).toBe("1/3");
  });

  it("shows only the elapsed time when done", () => {
    expect(sandboxBootSummary({ steps: list, state: Done, elapsedMs: 10200 })).toBe("10.2s");
    expect(sandboxBootSummary({ steps: list, state: Done })).toBeUndefined();
  });

  it("prefers the error text, then the failed step label", () => {
    const failed = steps([Done, Error]);
    expect(sandboxBootSummary({ steps: failed, state: Error, error: "boom" })).toBe("boom");
    expect(sandboxBootSummary({ steps: failed, state: Error })).toBe("Step label 1");
  });

  it("has no summary while pending", () => {
    expect(sandboxBootSummary({ steps: list, state: Pending, elapsedMs: 0 })).toBeUndefined();
  });
});

describe("SandboxBoot", () => {
  it("renders open while running with every step label and the running status", () => {
    const html = render();

    expect(html).toContain("Starting sandbox");
    expect(html).toContain("1/3 · 4.4s");
    expect(html).toContain('data-status="running"');
    expect(html).toContain("Step label 0");
    expect(html).toContain("Step label 1");
    expect(html).toContain("Step label 2");
    expect(html).toContain("detail 1");
  });

  it("marks pending steps as pending", () => {
    expect(render()).toContain('data-status="pending"');
  });

  it("renders collapsed when done", () => {
    const html = render({ steps: steps([Done, Done]), state: Done, elapsedMs: 9800 });

    expect(html).toContain("Sandbox ready");
    expect(html).toContain("9.8s");
    expect(html).not.toContain("Step label 0");
    expect(html).not.toContain("Retry");
  });

  it("renders open on error with the failed step detail in destructive tone", () => {
    const html = render({ steps: steps([Done, Error, Pending]), state: Error });

    expect(html).toContain("Sandbox failed to start");
    expect(html).toContain('data-status="error"');
    expect(html).toContain("Step label 1");
    expect(html).toContain(CLONE_ERROR);
    expect(html).toContain("text-destructive");
  });

  it("shows Retry only on error and only with onRetry", () => {
    const failed = { steps: steps([Done, Error]), state: Error };

    expect(render({ ...failed, onRetry: () => {} })).toContain("Retry");
    expect(render(failed)).not.toContain("Retry");
    expect(render({ onRetry: () => {} })).not.toContain("Retry");
  });
});
