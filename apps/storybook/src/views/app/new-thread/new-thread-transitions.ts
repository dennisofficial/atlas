import {
  ENewThreadOutcome,
  ENewThreadStage,
  isFailureStage,
  startStageOf,
} from "./new-thread-types";

export interface ThreadCore {
  stage: ENewThreadStage;
  prompt: string;
  draft: string;
}

interface SendInput {
  core: ThreadCore;
  text: string;
  outcome: ENewThreadOutcome;
}

interface RetryInput {
  core: ThreadCore;
  outcome: ENewThreadOutcome;
}

export function canStartFrom(stage: ENewThreadStage): boolean {
  return stage === ENewThreadStage.Draft || stage === ENewThreadStage.Empty || isFailureStage(stage);
}

export function sendFrom({ core, text, outcome }: SendInput): ThreadCore | undefined {
  if (!canStartFrom(core.stage)) return undefined;
  return { stage: startStageOf(outcome), prompt: text, draft: "" };
}

export function emptyFrom(core: ThreadCore): ThreadCore {
  return { stage: ENewThreadStage.Empty, prompt: "", draft: core.prompt };
}

export function retryFrom({ core, outcome }: RetryInput): ThreadCore {
  return { stage: startStageOf(outcome), prompt: core.prompt, draft: "" };
}
