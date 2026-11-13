import type { EventDraft } from './body'
import type { CallId } from './ids'
import type { JsonValue } from '../json/value'

export type ParkedResult = {
  callId: CallId
  name: string
  modelText?: string | undefined
  output?: JsonValue | undefined
  error?: { message: string } | undefined
}

export const parkedResultDraft = (args: ParkedResult): EventDraft => {
  const output = args.output === undefined ? {} : { output: args.output }
  if (args.error !== undefined) {
    return {
      type: 'tool-result',
      callId: args.callId,
      name: args.name,
      ...output,
      error: args.error,
    }
  }
  return {
    type: 'tool-result',
    callId: args.callId,
    name: args.name,
    ...output,
    modelText: args.modelText ?? '',
  }
}
