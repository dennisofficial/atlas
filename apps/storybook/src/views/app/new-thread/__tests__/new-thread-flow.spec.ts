import { describe, expect, it } from "bun:test";

import { EThreadStatus } from "../../../../fixtures/app";
import {
  EMPTY_THREAD_TITLE,
  FIXTURE_PROMPT,
  NO_PROJECT_LABEL,
  PENDING_THREAD_ID,
  pendingThreadOf,
  POD_STAGES,
  projectLabelOf,
  titleOf,
} from "../new-thread-data";
import { emptyFrom, retryFrom, sendFrom, type ThreadCore } from "../new-thread-transitions";
import { ENewThreadOutcome, ENewThreadStage, nextStage, startStageOf } from "../new-thread-types";

const SENT: ThreadCore = { stage: ENewThreadStage.WaitingForPod, prompt: FIXTURE_PROMPT, draft: "" };

describe("nextStage", () => {
  it("moves provisioning on to workspace setup and then streaming", () => {
    const outcome = ENewThreadOutcome.Success;
    expect(nextStage({ stage: ENewThreadStage.WaitingForPod, outcome })).toBe(ENewThreadStage.SettingUpWorkspace);
    expect(nextStage({ stage: ENewThreadStage.SettingUpWorkspace, outcome })).toBe(ENewThreadStage.Streaming);
  });

  it("fails at the first stage when the outcome is a provision failure", () => {
    const next = nextStage({ stage: ENewThreadStage.WaitingForPod, outcome: ENewThreadOutcome.ProvisionFailed });
    expect(next).toBe(ENewThreadStage.ProvisionFailed);
  });

  it("leaves settled stages alone", () => {
    const outcome = ENewThreadOutcome.Success;
    expect(nextStage({ stage: ENewThreadStage.Idle, outcome })).toBe(ENewThreadStage.Idle);
    expect(nextStage({ stage: ENewThreadStage.Draft, outcome })).toBe(ENewThreadStage.Draft);
    expect(nextStage({ stage: ENewThreadStage.Empty, outcome })).toBe(ENewThreadStage.Empty);
  });
});

describe("startStageOf", () => {
  it("fails fast for the token outcome and provisions otherwise", () => {
    expect(startStageOf(ENewThreadOutcome.NoVercelToken)).toBe(ENewThreadStage.NoVercelToken);
    expect(startStageOf(ENewThreadOutcome.Success)).toBe(ENewThreadStage.WaitingForPod);
    expect(startStageOf(ENewThreadOutcome.ProvisionFailed)).toBe(ENewThreadStage.WaitingForPod);
  });

  it("has no not-signed-in outcome", () => {
    expect(Object.values(ENewThreadOutcome)).not.toContain("not-signed-in");
    expect(Object.values(ENewThreadStage)).not.toContain("not-signed-in");
  });
});

describe("sendFrom", () => {
  const outcome = ENewThreadOutcome.Success;

  it("starts provisioning from Draft with an empty composer", () => {
    const core: ThreadCore = { stage: ENewThreadStage.Draft, prompt: "", draft: "hello" };
    expect(sendFrom({ core, text: "hello", outcome })).toEqual({
      stage: ENewThreadStage.WaitingForPod,
      prompt: "hello",
      draft: "",
    });
  });

  it("provisions again from Empty", () => {
    const core: ThreadCore = { stage: ENewThreadStage.Empty, prompt: "", draft: FIXTURE_PROMPT };
    const next = sendFrom({ core, text: FIXTURE_PROMPT, outcome });
    expect(next?.stage).toBe(ENewThreadStage.WaitingForPod);
    expect(next?.prompt).toBe(FIXTURE_PROMPT);
    expect(next?.draft).toBe("");
  });

  it("keeps the composer empty after a failure outcome", () => {
    const core: ThreadCore = { stage: ENewThreadStage.Empty, prompt: "", draft: FIXTURE_PROMPT };
    const next = sendFrom({ core, text: FIXTURE_PROMPT, outcome: ENewThreadOutcome.NoVercelToken });
    expect(next).toEqual({ stage: ENewThreadStage.NoVercelToken, prompt: FIXTURE_PROMPT, draft: "" });
  });

  it("refuses while provisioning, streaming or idle", () => {
    for (const stage of [ENewThreadStage.WaitingForPod, ENewThreadStage.Streaming, ENewThreadStage.Idle]) {
      expect(sendFrom({ core: { ...SENT, stage }, text: "x", outcome })).toBeUndefined();
    }
  });
});

describe("cancel and edit message", () => {
  it("go to Empty with the text restored, never to Draft", () => {
    const failed = { ...SENT, stage: ENewThreadStage.ProvisionFailed };
    for (const core of [SENT, failed]) {
      const next = emptyFrom(core);
      expect(next.stage).toBe(ENewThreadStage.Empty);
      expect(next.stage).not.toBe(ENewThreadStage.Draft);
      expect(next.draft).toBe(FIXTURE_PROMPT);
      expect(next.prompt).toBe("");
    }
  });
});

describe("retryFrom", () => {
  it("reuses the sent message and leaves the composer empty", () => {
    const failed = { ...SENT, stage: ENewThreadStage.ProvisionFailed };
    expect(retryFrom({ core: failed, outcome: ENewThreadOutcome.Success })).toEqual({
      stage: ENewThreadStage.WaitingForPod,
      prompt: FIXTURE_PROMPT,
      draft: "",
    });
  });
});

describe("pod stage labels", () => {
  it("uses the real birth wave labels in sentence case", () => {
    expect(POD_STAGES.map((entry) => entry.label)).toEqual(["Waiting for the pod", "Setting up the workspace"]);
  });
});

describe("project labels", () => {
  it("shows owner/name for a project and No project for null", () => {
    expect(projectLabelOf("atlas")).toBe("dennisofficial/atlas");
    expect(projectLabelOf(null)).toBe(NO_PROJECT_LABEL);
  });
});

describe("titleOf", () => {
  it("truncates long prompts, keeps short ones and titles an empty thread", () => {
    expect(titleOf(FIXTURE_PROMPT)).toBe(FIXTURE_PROMPT);
    expect(titleOf("x".repeat(80))).toHaveLength(58);
    expect(titleOf("")).toBe(EMPTY_THREAD_TITLE);
  });
});

describe("pendingThreadOf", () => {
  const base = { prompt: FIXTURE_PROMPT, projectId: "atlas" };

  it("is absent in draft", () => {
    expect(pendingThreadOf({ ...base, stage: ENewThreadStage.Draft })).toBeUndefined();
  });

  it("keeps a thread with no project, ungrouped", () => {
    const unprojected = pendingThreadOf({ ...base, projectId: null, stage: ENewThreadStage.Idle });
    expect(unprojected?.id).toBe(PENDING_THREAD_ID);
    expect(unprojected?.projectId).toBeNull();
  });

  it("runs while starting, stays in Empty and failures, and idles when done", () => {
    const running = pendingThreadOf({ ...base, stage: ENewThreadStage.WaitingForPod });
    expect(running?.id).toBe(PENDING_THREAD_ID);
    expect(running?.status).toBe(EThreadStatus.Running);
    expect(pendingThreadOf({ ...base, prompt: "", stage: ENewThreadStage.Empty })?.status).toBe(EThreadStatus.Idle);
    expect(pendingThreadOf({ ...base, stage: ENewThreadStage.ProvisionFailed })?.status).toBe(EThreadStatus.Idle);
    expect(pendingThreadOf({ ...base, stage: ENewThreadStage.Idle })?.status).toBe(EThreadStatus.Idle);
  });
});
