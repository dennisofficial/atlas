import type { CodeQualityReviewedBody, EventDraft, ToolCall, ToolOutcome } from '@dltech/atlas-core'

export function resultDraft(args: {
  call: ToolCall
  result: ToolOutcome
  interrupted: boolean
  qualityReviews?: readonly CodeQualityReviewedBody[] | undefined
}): EventDraft {
  if (args.result.ok) {
    return {
      type: 'tool-result',
      callId: args.call.callId,
      name: args.call.name,
      output: args.result.output,
      modelText: args.result.modelText,
      ...(args.result.modelParts === undefined ? {} : { modelParts: args.result.modelParts }),
      ...(args.qualityReviews === undefined || args.qualityReviews.length === 0
        ? {}
        : { qualityReviews: args.qualityReviews }),
    }
  }

  return {
    type: 'tool-result',
    callId: args.call.callId,
    name: args.call.name,
    output: undefined,
    error: { message: args.result.reason },
    ...(args.interrupted ? { interrupted: true } : {}),
  }
}
