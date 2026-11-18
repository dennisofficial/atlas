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
  if (draft.type !== 'user-said' && draft.type !== 'input-withdrawn') return undefined
  const id = draft.inboxId
  return id !== undefined && Number.isInteger(id) && id >= 1 ? id : undefined
}

const consumesPosted = (draft: AppendBody, inboxId: number): boolean =>
  (draft.type === 'user-said' || draft.type === 'input-withdrawn') && draft.inboxId === inboxId

export const draftGroups = (drafts: readonly AppendBody[]): AppendBody[][] => {
  const groups: AppendBody[][] = []
  for (let index = 0; index < drafts.length; index += 1) {
    const draft = drafts[index] as AppendBody
    const next = drafts[index + 1]
    if (
      draft.type === 'input-posted' &&
      next !== undefined &&
      consumesPosted(next, draft.inboxId)
    ) {
      groups.push([draft, next])
      index += 1
      continue
    }
    groups.push([draft])
  }
  return groups
}

export const abortedOnHandoff = (draft: AppendBody, draining: boolean): AppendBody => {
  if (!draining) return draft
  if (draft.type !== 'assistant-said' || draft.interrupted !== true) return draft
  return { ...draft, aborted: 'handoff' }
}
