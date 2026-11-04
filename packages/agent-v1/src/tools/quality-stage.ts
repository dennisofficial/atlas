import type {
  CodeQualityReviewedBody,
  Event,
  EventDraft,
  RunId,
  ThreadId,
  ToolCall,
  ToolOutcome,
} from '@dltech/atlas-core'

export type QualityReviewOutcome = {
  reviews: readonly CodeQualityReviewedBody[]
  nudge: EventDraft | undefined
}

export type QualityStagePort = {
  captureEnabled(args: { threadId: ThreadId }): boolean
  review(args: {
    call: ToolCall
    runId: RunId
    result: ToolOutcome
    events: readonly Event[]
    projectDirectory: string
    signal: AbortSignal
  }): Promise<QualityReviewOutcome>
}

export const NO_QUALITY_STAGE: QualityStagePort = {
  captureEnabled: () => false,
  review: async () => ({ reviews: [], nudge: undefined }),
}
