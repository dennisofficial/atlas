import { isTurnTaking, type EventDraft, type ThreadId } from '@dltech/atlas-core'

import type { InputBatch } from './input-batch'
import type { IntakeSource } from './message-intake'

export function retainedSource(args: {
  drain: (args: { threadId: ThreadId }) => readonly EventDraft[]
  threadsAwaitingInput: () => readonly ThreadId[]
  threadsWithPendingInput?: (() => readonly ThreadId[]) | undefined
  subscribe: (listener: () => void) => () => void
  witness: (args: { threadId: ThreadId }) => unknown
}): IntakeSource {
  const retained = new Map<ThreadId, readonly EventDraft[]>()
  const witnesses = new Map<ThreadId, { pending: unknown; retained: unknown }>()
  return {
    subscribe: args.subscribe,
    threadsWithPendingInput: () => [...new Set([
      ...(args.threadsWithPendingInput?.() ?? args.threadsAwaitingInput()),
      ...retained.keys(),
    ])],
    threadsAwaitingInput: () => [...new Set([
      ...args.threadsAwaitingInput(),
      ...[...retained].filter(([, drafts]) => drafts.some(isTurnTaking)).map(([threadId]) => threadId),
    ])],
    witness: ({ threadId }) => {
      const pending = args.witness({ threadId })
      const held = retained.get(threadId)
      const prior = witnesses.get(threadId)
      if (prior !== undefined && prior.pending === pending && prior.retained === held) return prior
      const next = { pending, retained: held }
      witnesses.set(threadId, next)
      return next
    },
    prepare: ({ threadId }): InputBatch => {
      const drafts = retained.get(threadId) ?? args.drain({ threadId })
      if (drafts.length > 0) retained.set(threadId, drafts)
      return {
        drafts,
        wakesTurn: drafts.some(isTurnTaking),
        acknowledge: () => {
          if (retained.get(threadId) === drafts) retained.delete(threadId)
        },
      }
    },
  }
}
