import type { RecordEvent } from '@dltech/atlas-core'

import {
  withdrawSettlementsOf,
  type WithdrawIntent,
  type WithdrawIntentPort,
  type WithdrawSettlement,
  type WithdrawTarget,
} from './withdraw-queue'

const EMPTY: readonly WithdrawIntent[] = []

export type WithdrawStore = WithdrawIntentPort & {
  intentsOf: (sessionId: string) => readonly WithdrawIntent[]
  takeSettlements: (args: {
    sessionId: string
    events: readonly RecordEvent[]
  }) => readonly WithdrawSettlement[]
  clear: (sessionId: string) => void
  subscribe: (args: { sessionId: string; listener: () => void }) => () => void
}

export const createWithdrawStore = (): WithdrawStore => {
  const bySession = new Map<string, readonly WithdrawIntent[]>()
  const listeners = new Map<string, Set<() => void>>()
  let lastRequestId = 0

  const emit = (sessionId: string): void => {
    for (const listener of [...(listeners.get(sessionId) ?? [])]) listener()
  }

  const intentsOf = (sessionId: string): readonly WithdrawIntent[] =>
    bySession.get(sessionId) ?? EMPTY

  const replace = (sessionId: string, intents: readonly WithdrawIntent[]): void => {
    if (intents.length === 0) bySession.delete(sessionId)
    else bySession.set(sessionId, intents)
    emit(sessionId)
  }

  const holds = (intent: WithdrawIntent): boolean =>
    intentsOf(intent.sessionId).some((entry) => entry.requestId === intent.requestId)

  const heldFor = (target: WithdrawTarget): boolean =>
    intentsOf(target.sessionId).some((entry) => entry.targetInboxId === target.targetInboxId)

  return {
    request: (target) => {
      if (heldFor(target)) return null
      lastRequestId += 1
      const intent: WithdrawIntent = { ...target, requestId: lastRequestId }
      replace(target.sessionId, [...intentsOf(target.sessionId), intent])
      return intent
    },
    discard: (intent) => {
      if (!holds(intent)) return
      replace(
        intent.sessionId,
        intentsOf(intent.sessionId).filter((entry) => entry.requestId !== intent.requestId),
      )
    },
    holds,
    intentsOf,
    takeSettlements: ({ sessionId, events }) => {
      const intents = intentsOf(sessionId)
      if (intents.length === 0) return []
      const settlements = withdrawSettlementsOf({ intents, events })
      const settled = new Set(settlements.map((entry) => entry.targetInboxId))
      const kept = intents.filter((entry) => !settled.has(entry.targetInboxId))
      if (kept.length !== intents.length) replace(sessionId, kept)
      return settlements
    },
    clear: (sessionId) => {
      if (!bySession.has(sessionId)) return
      replace(sessionId, EMPTY)
    },
    subscribe: ({ sessionId, listener }) => {
      const held = listeners.get(sessionId) ?? new Set<() => void>()
      listeners.set(sessionId, held)
      held.add(listener)
      return () => {
        held.delete(listener)
        if (held.size === 0) listeners.delete(sessionId)
      }
    },
  }
}

export const withdrawStore = createWithdrawStore()
