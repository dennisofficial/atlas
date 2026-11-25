import type { EventDraft, PluginEventBody, RecordBody, RecordEventBody } from '@dltech/atlas-core'

export class RecordCorruptionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RecordCorruptionError'
  }
}

export type AppendBody = EventDraft | RecordBody | PluginEventBody

export const toRecordBody = (draft: AppendBody): RecordEventBody => {
  if (draft.type === 'history-compacted') {
    throw new RecordCorruptionError('history-compacted is not a v2 record body')
  }
  return draft
}

export const inboxIdOf = (draft: AppendBody): number | undefined => {
  if (draft.type !== 'user-said' && draft.type !== 'input-withdrawn') return undefined
  const id = draft.inboxId
  return id !== undefined && Number.isInteger(id) && id >= 1 ? id : undefined
}

export class TurnAbortedError extends Error {
  constructor(message = 'the turn was interrupted before its dispatch was recorded') {
    super(message)
    this.name = 'TurnAbortedError'
  }
}

export const abortErrorOf = (signal: AbortSignal): Error =>
  signal.reason instanceof Error ? signal.reason : new TurnAbortedError()

export const abortedOnHandoff = (draft: AppendBody, draining: boolean): AppendBody => {
  if (!draining) return draft
  if (draft.type !== 'assistant-said' || draft.interrupted !== true) return draft
  return { ...draft, aborted: 'handoff' }
}
