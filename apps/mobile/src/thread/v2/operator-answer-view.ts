import type { OperatorRequestEntry } from '@dltech/atlas-client/transcript'
import type { Event, V2Event } from '@dltech/atlas-core'
import { pendingOperatorRequestOf } from '@dltech/atlas-plugin-operator/client'

export enum EAnswerPhase {
  Sending = 'sending',
  Sent = 'sent',
  Failed = 'failed',
}

export type OperatorAnswerState = {
  callId: string
  phase: EAnswerPhase
  error?: string | undefined
}

export type PendingOperatorAnswer = {
  callId: string
  prompt: string
  shell: boolean
}

export type OperatorAnswerView = {
  request: PendingOperatorAnswer | null
  sending: boolean
  error: string | undefined
}

const requestOf = (entry: OperatorRequestEntry): PendingOperatorAnswer => ({
  callId: entry.callId,
  prompt: entry.prompt,
  shell: entry.shellId !== undefined,
})

export const operatorAnswerViewOf = (args: {
  events: readonly (Event | V2Event)[]
  answer: OperatorAnswerState | null
}): OperatorAnswerView => {
  const entry = pendingOperatorRequestOf({ events: args.events })
  if (entry === null) return { request: null, sending: false, error: undefined }

  const current = args.answer !== null && args.answer.callId === entry.callId ? args.answer : null

  return {
    request: requestOf(entry),
    sending: current?.phase === EAnswerPhase.Sending || current?.phase === EAnswerPhase.Sent,
    error: current?.phase === EAnswerPhase.Failed ? current.error : undefined,
  }
}
