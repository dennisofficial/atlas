import type { EventDraft } from './body'
import type { CallId } from './ids'

export type ParkedResult = {
  callId: CallId
  name: string
  modelText?: string | undefined
  error?: { message: string } | undefined
}

export const parkedResultDraft = (args: ParkedResult): EventDraft => {
  if (args.error !== undefined) {
    return { type: 'tool-result', callId: args.callId, name: args.name, error: args.error }
  }
  return {
    type: 'tool-result',
    callId: args.callId,
    name: args.name,
    modelText: args.modelText ?? '',
  }
}
