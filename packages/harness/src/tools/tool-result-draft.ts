import type { EventDraft, ToolCall, ToolOutcome } from '@dltech/atlas-core'

export function resultDraft(args: { call: ToolCall; result: ToolOutcome; interrupted: boolean }): EventDraft {
  if (args.result.ok) {
    return {
      type: 'tool-result',
      callId: args.call.callId,
      name: args.call.name,
      output: args.result.output,
      modelText: args.result.modelText,
      ...(args.result.modelParts === undefined ? {} : { modelParts: args.result.modelParts }),
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
