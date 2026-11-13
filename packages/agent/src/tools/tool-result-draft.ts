import {
  isParkedOutcome,
  type CodeQualityReviewedBody,
  type EventDraft,
  type ParkedToolOutcome,
  type ToolCall,
  type ToolOutcome,
} from '@dltech/atlas-core'

export function parkedDraftOf(args: {
  call: { callId: ToolCall['callId']; name: string }
  result: ParkedToolOutcome
}): EventDraft {
  return {
    type: 'tool-parked',
    callId: args.call.callId,
    name: args.call.name,
    ...(args.result.request === undefined ? {} : { request: args.result.request }),
  }
}

export function resultDraft(args: {
  call: ToolCall
  result: ToolOutcome
  interrupted: boolean
  qualityReviews?: readonly CodeQualityReviewedBody[] | undefined
}): EventDraft {
  if (isParkedOutcome(args.result)) return parkedDraftOf({ call: args.call, result: args.result })

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
