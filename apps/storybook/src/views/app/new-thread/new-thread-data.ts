import { EToolKind } from "@dltech/atlas-ui/ai/tool";

import { EThreadStatus, findProject, type AppThread } from "../../../fixtures/app";
import type { StepSpec } from "../session/transcript-data";
import { EFirstMessage, EPodProgress, isStartingPod } from "./new-thread-types";

export interface PodStage {
  pod: EPodProgress;
  label: string;
}

export const DEFAULT_PROJECT_ID = "atlas";

export const MODEL_LABEL = "Claude Opus · High";

export const NO_PROJECT_LABEL = "No project";

export const EMPTY_THREAD_TITLE = "New thread";

export function projectLabelOf(projectId: string | null): string {
  if (projectId === null) return NO_PROJECT_LABEL;
  const project = findProject(projectId);
  return `${project.owner}/${project.name}`;
}

export const FIXTURE_PROMPT = "Fix the flaky reconnect spec in apps/serve.";

export const POD_STAGES: PodStage[] = [
  { pod: EPodProgress.WaitingForPod, label: "Waiting for the pod" },
  { pod: EPodProgress.SettingUpWorkspace, label: "Setting up the workspace" },
];

export const POD_DELAY_MS: Partial<Record<EPodProgress, number>> = {
  [EPodProgress.WaitingForPod]: 2500,
  [EPodProgress.SettingUpWorkspace]: 2000,
};

export const STEP_DELAYS_MS = [650, 900, 700, 850, 800];

export const SETTLE_DELAY_MS = 700;

export const SEEDED_ELAPSED: Partial<Record<EPodProgress, number>> = {
  [EPodProgress.WaitingForPod]: 2,
  [EPodProgress.SettingUpWorkspace]: 6,
  [EPodProgress.Ready]: 8,
  [EPodProgress.ProvisionFailed]: 3,
};

export const SEEDED_REPLY_WORDS = 18;

export const PENDING_THREAD_ID = "thr-new-pending";

export const PROVISION_FAILURE_DETAIL = "Vercel API 402: sandbox concurrency limit reached";

export const FIRST_TURN_STEPS: StepSpec[] = [
  {
    id: "s-status",
    kind: EToolKind.Shell,
    label: "git status --short",
    output: "nothing to commit, working tree clean",
    elapsed: "0.2s",
  },
  { id: "s-search", kind: EToolKind.Search, label: "reconnect in apps/serve/src", output: "14 matches in 3 files" },
  {
    id: "s-read",
    kind: EToolKind.Read,
    label: "apps/serve/src/__tests__/reconnect.spec.ts",
    output: "212 lines",
  },
  {
    id: "s-edit",
    kind: EToolKind.Edit,
    label: "apps/serve/src/__tests__/reconnect.spec.ts",
    elapsed: "0.4s",
  },
  {
    id: "s-test",
    kind: EToolKind.Shell,
    label: "bun test apps/serve",
    output: "31 pass\n0 fail\nRan 31 tests across 6 files. [1.84s]",
    elapsed: "1.9s",
  },
];

export const FIRST_TURN_REPLY =
  "The reconnect spec asserted before the socket finished closing, so it passed or failed on timing. It now waits for the close event first. bun test apps/serve passes 31 of 31. Want me to open a draft PR?";

export const REPLY_WORDS = FIRST_TURN_REPLY.split(" ");

export function titleOf(prompt: string): string {
  if (prompt === "") return EMPTY_THREAD_TITLE;
  return prompt.length > 60 ? `${prompt.slice(0, 57)}…` : prompt;
}

interface PendingThreadInput {
  prompt: string;
  projectId: string | null;
  pod: EPodProgress;
  message: EFirstMessage;
}

export function pendingThreadOf({ prompt, projectId, pod, message }: PendingThreadInput): AppThread | undefined {
  if (pod === EPodProgress.None) return undefined;
  const live = isStartingPod(pod) || message === EFirstMessage.Running;
  return {
    id: PENDING_THREAD_ID,
    projectId,
    title: titleOf(prompt),
    status: live ? EThreadStatus.Running : EThreadStatus.Idle,
    created: "just now",
    updated: "just now",
    added: 0,
    removed: 0,
    changed: 0,
    model: MODEL_LABEL,
  };
}
