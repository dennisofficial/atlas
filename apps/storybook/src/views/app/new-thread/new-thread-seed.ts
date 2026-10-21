import { FIXTURE_PROMPT, REPLY_WORDS, SEEDED_ELAPSED, SEEDED_REPLY_WORDS, FIRST_TURN_STEPS } from "./new-thread-data";
import type { ThreadCore } from "./new-thread-transitions";
import { EFirstMessage, EPodProgress, isFailedPod, isStartingPod } from "./new-thread-types";

export interface ThreadSeed {
  pod: EPodProgress;
  message: EFirstMessage;
}

export interface TurnProgress {
  steps: number;
  words: number;
}

export function seededCore({ pod, message }: ThreadSeed): ThreadCore {
  const sent = message !== EFirstMessage.None;
  const takenBack = !sent && (isStartingPod(pod) || isFailedPod(pod));
  return {
    pod,
    message,
    prompt: sent ? FIXTURE_PROMPT : "",
    draft: takenBack ? FIXTURE_PROMPT : "",
  };
}

export function seededElapsed(pod: EPodProgress): number {
  return SEEDED_ELAPSED[pod] ?? 0;
}

export function seededTurn(message: EFirstMessage): TurnProgress {
  if (message === EFirstMessage.Done) return { steps: FIRST_TURN_STEPS.length, words: REPLY_WORDS.length };
  if (message === EFirstMessage.Running) return { steps: FIRST_TURN_STEPS.length, words: SEEDED_REPLY_WORDS };
  return { steps: 0, words: 0 };
}
