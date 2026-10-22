import type { TranscriptEntry } from './transcript-model'

export type StepFailure = { message: string | null }

export type TranscriptModel = {
  entries: readonly TranscriptEntry[]
  isEmpty: boolean
  streaming: boolean
  failure: StepFailure | null
}

export const EMPTY_TRANSCRIPT: TranscriptModel = {
  entries: [],
  isEmpty: true,
  streaming: false,
  failure: null,
}
