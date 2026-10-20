import { EToolKind, EToolState } from "@dltech/atlas-ui/ai/tool";
import { EStepStatus, type PlanStep } from "@dltech/atlas-ui/ai/plan";
import type { QueuedMessage } from "@dltech/atlas-ui/ai/task-dock";

import {
  BUN_TEST_OUTPUT,
  GIT_STATUS_OUTPUT,
  REASONING_TEXT,
  TYPECHECK_OUTPUT,
} from "../../../fixtures/agent";
import { ESessionState } from "./session-types";

export interface StepSpec {
  id: string;
  kind: EToolKind;
  label: string;
  state?: EToolState;
  output?: string;
  errorText?: string;
  elapsed?: string;
}

export const FIRST_PROMPT =
  "Rebase packages/ui on shadcn base-nova, keep our colors, and fix the diff viewer.";

export const SECOND_PROMPT =
  "Looks good. Finish it: typecheck, run the specs, drop the legacy page, then open a PR.";

export const FIRST_TURN_STEPS: StepSpec[] = [
  { id: "t1-status", kind: EToolKind.Shell, label: "git status --short", output: GIT_STATUS_OUTPUT, elapsed: "0.2s" },
  { id: "t1-read", kind: EToolKind.Read, label: "packages/ui/src/ai/diff-viewer.tsx", output: "148 lines" },
  { id: "t1-search", kind: EToolKind.Search, label: "oklch( in packages/ui/src/tokens", output: "31 matches in 4 files" },
  { id: "t1-semantic", kind: EToolKind.Edit, label: "packages/ui/src/tokens/semantic.ts", elapsed: "0.4s" },
  { id: "t1-generate", kind: EToolKind.Shell, label: "bun run generate", output: "wrote src/styles/theme.css (2,061 lines)", elapsed: "1.8s" },
  { id: "t1-theme", kind: EToolKind.Edit, label: "packages/ui/src/styles/theme.css", elapsed: "0.3s" },
  { id: "t1-diff", kind: EToolKind.Edit, label: "packages/ui/src/ai/diff-viewer.tsx", elapsed: "0.5s" },
  { id: "t1-tool", kind: EToolKind.Edit, label: "packages/ui/src/ai/tool.tsx", elapsed: "0.6s" },
];

export const FIRST_TURN_REASONING = REASONING_TEXT;

const DIFF_STEP: StepSpec = {
  id: "t2-diff",
  kind: EToolKind.Shell,
  label: "git diff --stat origin/main",
  output: " 5 files changed, 2178 insertions(+), 5 deletions(-)",
  elapsed: "0.3s",
};

const PAGE_STEP: StepSpec = {
  id: "t2-page",
  kind: EToolKind.Edit,
  label: "apps/web/src/app/page.tsx",
  elapsed: "0.2s",
};

const TYPECHECK_RUNNING: StepSpec = {
  id: "t2-typecheck",
  kind: EToolKind.Shell,
  label: "bun run typecheck",
  state: EToolState.Running,
};

const TYPECHECK_FAILED: StepSpec = {
  id: "t2-typecheck",
  kind: EToolKind.Shell,
  label: "bun run typecheck",
  state: EToolState.Error,
  errorText: TYPECHECK_OUTPUT,
  elapsed: "4.1s",
};

const TYPECHECK_DONE: StepSpec = {
  id: "t2-typecheck",
  kind: EToolKind.Shell,
  label: "bun run typecheck",
  output: "Found 0 errors.",
  elapsed: "4.3s",
};

const TEST_DONE: StepSpec = {
  id: "t2-test",
  kind: EToolKind.Shell,
  label: "bun test packages/ui",
  output: BUN_TEST_OUTPUT,
  elapsed: "0.9s",
};

const PR_DONE: StepSpec = {
  id: "t2-pr",
  kind: EToolKind.Shell,
  label: "gh pr create --draft",
  output: "https://github.com/dennisofficial/atlas/pull/1316",
  elapsed: "2.4s",
};

export const SECOND_TURN_STEPS: Record<ESessionState, StepSpec[]> = {
  [ESessionState.Running]: [DIFF_STEP, PAGE_STEP, TYPECHECK_RUNNING],
  [ESessionState.ApprovalPending]: [DIFF_STEP, PAGE_STEP, TYPECHECK_FAILED],
  [ESessionState.Idle]: [DIFF_STEP, PAGE_STEP, TYPECHECK_DONE, TEST_DONE, PR_DONE],
};

export const SECOND_TURN_DURATION: Record<ESessionState, string> = {
  [ESessionState.Running]: "2m",
  [ESessionState.ApprovalPending]: "3m",
  [ESessionState.Idle]: "6m",
};

const PLAN_TITLES = [
  "Map tokens onto shadcn variable names",
  "Regenerate theme.css",
  "Restyle the diff viewer",
  "Run typecheck",
  "Run the token and ui specs",
  "Remove the legacy home page",
  "Open a pull request",
];

const DONE_COUNT: Record<ESessionState, number> = {
  [ESessionState.Running]: 3,
  [ESessionState.ApprovalPending]: 3,
  [ESessionState.Idle]: PLAN_TITLES.length,
};

const CURRENT_STATUS: Record<ESessionState, EStepStatus> = {
  [ESessionState.Running]: EStepStatus.Running,
  [ESessionState.ApprovalPending]: EStepStatus.Error,
  [ESessionState.Idle]: EStepStatus.Done,
};

export function planFor(state: ESessionState): PlanStep[] {
  const done = DONE_COUNT[state];
  return PLAN_TITLES.map((title, index) => {
    const id = `${index + 1}`;
    if (index < done) return { id, title, status: EStepStatus.Done };
    if (index === done) return { id, title, status: CURRENT_STATUS[state] };
    return { id, title, status: EStepStatus.Pending };
  });
}

export const INITIAL_QUEUE: Record<ESessionState, QueuedMessage[]> = {
  [ESessionState.Running]: [
    { id: "q1", text: "Also bump the storybook addon versions while you are in there" },
    { id: "q2", text: "Squash the commits before opening the PR" },
  ],
  [ESessionState.ApprovalPending]: [],
  [ESessionState.Idle]: [],
};
