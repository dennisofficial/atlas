import { useEffect, useState } from "react";

import type { QueuedMessage } from "@dltech/atlas-ui/ai/task-dock";

import {
  FIRST_TURN_STEPS,
  FIXTURE_PROMPT,
  REPLY_WORDS,
  SEEDED_ELAPSED,
  SEEDED_REPLY_WORDS,
  SETTLE_DELAY_MS,
  STAGE_DELAY_MS,
  STEP_DELAYS_MS,
} from "./new-thread-data";
import { emptyFrom, retryFrom, sendFrom, type ThreadCore } from "./new-thread-transitions";
import { ENewThreadOutcome, ENewThreadStage, isProvisioningStage, nextStage } from "./new-thread-types";

export interface NewThreadFlowOptions {
  initialStage: ENewThreadStage;
  initialProjectId: string | null;
  outcome: ENewThreadOutcome;
  autoRun: boolean;
}

export interface NewThreadFlow {
  stage: ENewThreadStage;
  prompt: string;
  draft: string;
  projectId: string | null;
  elapsed: number;
  visibleSteps: number;
  replyWords: number;
  queued: QueuedMessage[];
  handleDraftChange: (value: string) => void;
  handleProjectChange: (projectId: string | null) => void;
  handleSend: (text: string) => void;
  handleCancel: () => void;
  handleRetry: () => void;
  handleEditMessage: () => void;
  handleRemoveQueued: (id: string) => void;
}

const STEP_COUNT = FIRST_TURN_STEPS.length;

function hasSentMessage(stage: ENewThreadStage): boolean {
  return stage !== ENewThreadStage.Draft && stage !== ENewThreadStage.Empty;
}

function seededCore(stage: ENewThreadStage): ThreadCore {
  if (stage === ENewThreadStage.Empty) return { stage, prompt: "", draft: FIXTURE_PROMPT };
  return { stage, prompt: hasSentMessage(stage) ? FIXTURE_PROMPT : "", draft: "" };
}

function seededReplyWords(stage: ENewThreadStage): number {
  if (stage === ENewThreadStage.Idle) return REPLY_WORDS.length;
  return stage === ENewThreadStage.Streaming ? SEEDED_REPLY_WORDS : 0;
}

function seededSteps(stage: ENewThreadStage): number {
  return stage === ENewThreadStage.Streaming || stage === ENewThreadStage.Idle ? STEP_COUNT : 0;
}

export function useNewThreadFlow({
  initialStage,
  initialProjectId,
  outcome,
  autoRun,
}: NewThreadFlowOptions): NewThreadFlow {
  const [core, setCore] = useState(() => seededCore(initialStage));
  const [projectId, setProjectId] = useState(initialProjectId);
  const [elapsed, setElapsed] = useState(SEEDED_ELAPSED[initialStage] ?? 0);
  const [visibleSteps, setVisibleSteps] = useState(seededSteps(initialStage));
  const [replyWords, setReplyWords] = useState(seededReplyWords(initialStage));
  const [queued, setQueued] = useState<QueuedMessage[]>([]);
  const { stage, prompt, draft } = core;

  const resetProgress = () => {
    setElapsed(0);
    setVisibleSteps(0);
    setReplyWords(0);
  };

  useEffect(() => {
    const delay = STAGE_DELAY_MS[stage];
    if (!autoRun || delay === undefined) return undefined;
    const timer = setTimeout(() => setCore((previous) => ({ ...previous, stage: nextStage({ stage, outcome }) })), delay);
    return () => clearTimeout(timer);
  }, [autoRun, stage, outcome]);

  useEffect(() => {
    if (!autoRun || !isProvisioningStage(stage)) return undefined;
    const interval = setInterval(() => setElapsed((seconds) => seconds + 1), 1000);
    return () => clearInterval(interval);
  }, [autoRun, stage]);

  useEffect(() => {
    if (!autoRun || stage !== ENewThreadStage.Streaming) return undefined;
    if (visibleSteps < STEP_COUNT) {
      const timer = setTimeout(() => setVisibleSteps((count) => count + 1), STEP_DELAYS_MS[visibleSteps] ?? 700);
      return () => clearTimeout(timer);
    }
    if (replyWords < REPLY_WORDS.length) {
      const timer = setTimeout(() => setReplyWords((count) => count + 1), 45);
      return () => clearTimeout(timer);
    }
    const timer = setTimeout(() => setCore((previous) => ({ ...previous, stage: ENewThreadStage.Idle })), SETTLE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [autoRun, stage, visibleSteps, replyWords]);

  const handleDraftChange = (value: string) => setCore((previous) => ({ ...previous, draft: value }));

  const handleProjectChange = (next: string | null) => setProjectId(next);

  const handleSend = (text: string) => {
    const started = sendFrom({ core, text, outcome });
    if (started) {
      resetProgress();
      setCore(started);
      return;
    }
    if (isProvisioningStage(stage)) return;
    setQueued((previous) => [...previous, { id: `q-${previous.length + 1}-${text.length}`, text }]);
  };

  const handleEditMessage = () => setCore(emptyFrom(core));

  const handleCancel = handleEditMessage;

  const handleRetry = () => {
    resetProgress();
    setCore(retryFrom({ core, outcome }));
  };

  const handleRemoveQueued = (id: string) => setQueued((previous) => previous.filter((message) => message.id !== id));

  return {
    stage,
    prompt,
    draft,
    projectId,
    elapsed,
    visibleSteps,
    replyWords,
    queued,
    handleDraftChange,
    handleProjectChange,
    handleSend,
    handleCancel,
    handleRetry,
    handleEditMessage,
    handleRemoveQueued,
  };
}
