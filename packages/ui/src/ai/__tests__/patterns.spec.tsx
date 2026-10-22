import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from "react-dom/server";

import { ChainOfThought, EStepStatus } from "../chain-of-thought";
import { Checkpoint } from "../checkpoint";
import { AgentMessage, EFeedback, UserMessage } from "../message";
import { groupByProvider } from "../model-selector";
import { Plan, countDone } from "../plan";
import { Queue, splitTodos } from "../queue";
import { Reasoning } from "../reasoning";
import { Sources, dedupeSources } from "../sources";
import { StackTrace, parseStack } from "../stack-trace";
import { Task } from "../task";
import { Terminal, terminalTitle } from "../terminal";
import { ETestStatus, TestResults, countTests, formatCounts } from "../test-results";
import { EToolKind } from "../tool";

describe("Reasoning", () => {
  it("reads Thinking while running and Thought when done", () => {
    expect(renderToStaticMarkup(<Reasoning text="hm" running />)).toContain("Thinking");
    const done = renderToStaticMarkup(<Reasoning text="hm" duration="12s" />);

    expect(done).toContain("Thought");
    expect(done).toContain("12s");
  });

  it("renders a plain line with no trigger when there is no text", () => {
    expect(renderToStaticMarkup(<Reasoning text="" running />)).not.toContain(
      "trace-collapsible",
    );
  });
});

describe("Plan", () => {
  const steps = [
    { id: "1", title: "Read", status: EStepStatus.Done },
    { id: "2", title: "Edit", status: EStepStatus.Running },
    { id: "3", title: "Test", status: EStepStatus.Pending },
  ];

  it("counts done steps in the title", () => {
    expect(countDone(steps)).toBe(1);
    expect(renderToStaticMarkup(<Plan title="Plan: ship" steps={steps} />)).toContain(
      "1 of 3 done",
    );
  });

  it("marks pending steps as pending", () => {
    expect(renderToStaticMarkup(<Plan title="p" steps={steps} />)).toContain(
      'data-status="pending"',
    );
  });
});

describe("Queue", () => {
  const todos = [
    { id: "1", title: "a", done: false },
    { id: "2", title: "b", done: true },
    { id: "3", title: "c", done: false },
  ];

  it("splits todos into to do and completed", () => {
    const { pending, completed } = splitTodos(todos);

    expect(pending).toHaveLength(2);
    expect(completed).toHaveLength(1);
  });

  it("titles each section with its count", () => {
    const html = renderToStaticMarkup(<Queue todos={todos} />);

    expect(html).toContain("2 to do");
    expect(html).toContain("1 completed");
  });
});

describe("Task and ChainOfThought", () => {
  it("renders task steps in the tense of their status", () => {
    const html = renderToStaticMarkup(
      <Task
        title="Updated the page"
        defaultOpen
        steps={[
          { id: "1", kind: EToolKind.Read, label: "app/page.tsx" },
          { id: "2", kind: EToolKind.Edit, label: "app/page.tsx", status: EStepStatus.Running },
        ]}
      />,
    );

    expect(html).toContain("Read app/page.tsx");
    expect(html).toContain("Editing app/page.tsx");
  });

  it("summarises a finished chain and a running one", () => {
    const done = [{ id: "1", title: "Searched", status: EStepStatus.Done }];
    const running = [{ id: "2", title: "Reading", status: EStepStatus.Running }];

    expect(renderToStaticMarkup(<ChainOfThought steps={done} />)).toContain(
      "Researched in 1 step",
    );
    expect(renderToStaticMarkup(<ChainOfThought steps={running} />)).toContain(
      "Researching",
    );
  });
});

describe("Sources", () => {
  it("dedupes by url and counts what is left", () => {
    const sources = [
      { url: "https://a.dev/x" },
      { url: "https://a.dev/x" },
      { url: "https://b.dev", title: "B" },
    ];

    expect(dedupeSources(sources)).toHaveLength(2);
    expect(renderToStaticMarkup(<Sources sources={sources} defaultOpen />)).toContain(
      "Used 2 sources",
    );
  });

  it("falls back to the hostname and announces the new tab", () => {
    const html = renderToStaticMarkup(
      <Sources sources={[{ url: "https://a.dev/x" }]} defaultOpen />,
    );

    expect(html).toContain("a.dev");
    expect(html).toContain("(opens in a new tab)");
  });
});

describe("StackTrace", () => {
  const stack = `TypeError: x is undefined
    at run (src/a.ts:4:2)
    at beginWork (node_modules/react-dom/x.js:1:1)`;

  it("splits the error from the frames and flags internal ones", () => {
    const { error, frames } = parseStack(stack);

    expect(error).toBe("TypeError: x is undefined");
    expect(frames.map((frame) => frame.internal)).toEqual([false, true]);
    expect(frames[0]?.file).toBe("src/a.ts");
  });

  it("renders a failed line with a folded framework group", () => {
    const html = renderToStaticMarkup(<StackTrace stack={stack} defaultOpen />);

    expect(html).toContain("Failed: TypeError: x is undefined");
    expect(html).toContain('data-status="error"');
    expect(html).toContain("1 framework frames");
  });
});

describe("Terminal", () => {
  it("titles running, failed and finished commands", () => {
    const title = (running: boolean, exitCode?: number) =>
      terminalTitle({ command: "bun test", running, exitCode });

    expect(title(true)).toBe("Running bun test");
    expect(title(false, 1)).toBe("bun test exited with code 1");
    expect(title(false, 0)).toBe("Ran bun test");
  });

  it("flags non-zero exits as errors", () => {
    const html = renderToStaticMarkup(
      <Terminal command="bun test" output="1 fail" exitCode={1} />,
    );

    expect(html).toContain('data-status="error"');
  });
});

describe("TestResults", () => {
  const suites = [
    {
      name: "a.spec.ts",
      tests: [
        { name: "ok", status: ETestStatus.Passed },
        { name: "bad", status: ETestStatus.Failed, error: "expected 1" },
        { name: "later", status: ETestStatus.Skipped },
      ],
    },
  ];

  it("counts and formats results", () => {
    const counts = countTests(suites.flatMap((suite) => suite.tests));

    expect(formatCounts(counts)).toBe("3 tests, 1 failed, 1 skipped");
  });

  it("opens failing suites and lists every test", () => {
    const html = renderToStaticMarkup(<TestResults suites={suites} />);

    expect(html).toContain("Ran 3 tests, 1 failed, 1 skipped");
    expect(html).toContain("bad");
    expect(html).toContain("Skipped later");
  });
});

describe("Message, Checkpoint and ModelSelector", () => {
  it("renders agent actions only when handlers exist and pressed feedback", () => {
    const html = renderToStaticMarkup(
      <AgentMessage copyText="hi" feedback={EFeedback.Good} onFeedback={() => {}} onRetry={() => {}}>
        hi
      </AgentMessage>,
    );

    expect(html).toContain('aria-label="Copy"');
    expect(html).toContain('aria-label="Retry"');
    expect(html).toMatch(/aria-label="Good response"[^>]*aria-pressed="true"|aria-pressed="true"[^>]*aria-label="Good response"/);
    expect(renderToStaticMarkup(<AgentMessage>hi</AgentMessage>)).not.toContain("Copy");
  });

  it("hides actions while streaming", () => {
    expect(
      renderToStaticMarkup(
        <AgentMessage streaming copyText="x">
          hi
        </AgentMessage>,
      ),
    ).not.toContain('aria-label="Copy"');
  });

  it("aligns the user turn to the end", () => {
    expect(renderToStaticMarkup(<UserMessage>yo</UserMessage>)).toContain('data-align="end"');
  });

  it("renders a checkpoint restore button", () => {
    const html = renderToStaticMarkup(<Checkpoint label="Before refactor" />);

    expect(html).toContain("Before refactor");
    expect(html).toContain("Restore");
  });

  it("groups models by provider in first-seen order", () => {
    const groups = groupByProvider([
      { id: "a", label: "A", provider: "Anthropic" },
      { id: "o", label: "O", provider: "OpenAI" },
      { id: "b", label: "B", provider: "Anthropic" },
    ]);

    expect(groups.map((group) => group.provider)).toEqual(["Anthropic", "OpenAI"]);
    expect(groups[0]?.models.map((model) => model.id)).toEqual(["a", "b"]);
  });
});
