import type { EventDraft, PluginEventBody, RecordBody, V2Body } from '@dltech/atlas-core'

export class RecordCorruptionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RecordCorruptionError'
  }
}

export type AppendBody = EventDraft | RecordBody | PluginEventBody

export const toRecordBody = (draft: AppendBody): V2Body => {
  if (draft.type === 'history-compacted') {
    throw new RecordCorruptionError('history-compacted is not a v2 record body')
  }
  return draft
}

export const inboxIdOf = (draft: AppendBody): number | undefined => {
  if (draft.type !== 'user-said') return undefined
  const id = draft.inboxId
  return id !== undefined && Number.isInteger(id) && id >= 1 ? id : undefined
}

export const abortedOnHandoff = (draft: AppendBody, draining: boolean): AppendBody => {
  if (!draining) return draft
  if (draft.type !== 'assistant-said' || draft.interrupted !== true) return draft
  return { ...draft, aborted: 'handoff' }
}
