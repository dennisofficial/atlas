import type { StepFailure, TranscriptModel } from '@dltech/atlas-client/transcript'

import { stabilisedEntries } from './stable-entries'

const sameFailure = (left: StepFailure | null, right: StepFailure | null): boolean =>
  left === right ||
  (left !== null &&
    right !== null &&
    left.message === right.message &&
    left.failure === right.failure)

export const settledModel = (args: {
  previous: TranscriptModel
  derived: TranscriptModel
}): TranscriptModel => {
  const { previous, derived } = args
  const entries = stabilisedEntries({ previous: previous.entries, next: derived.entries })
  const unchanged =
    entries === previous.entries &&
    derived.isEmpty === previous.isEmpty &&
    derived.streaming === previous.streaming &&
    sameFailure(derived.failure, previous.failure)

  return unchanged ? previous : { ...derived, entries }
}
