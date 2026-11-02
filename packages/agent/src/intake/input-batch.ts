import type { EventDraft } from '@dltech/atlas-core'

export type InputBatch = {
  drafts: readonly EventDraft[]
  wakesTurn: boolean
  acknowledge: () => void
  release?: (() => void) | undefined
}

export function combineInput(batches: readonly InputBatch[]): InputBatch {
  return {
    drafts: batches.flatMap((batch) => batch.drafts),
    wakesTurn: batches.some((batch) => batch.wakesTurn),
    acknowledge: () => {
      for (const batch of batches) batch.acknowledge()
    },
    release: () => {
      for (const batch of batches) batch.release?.()
    },
  }
}
