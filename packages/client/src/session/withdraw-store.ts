import type { RecordEvent } from '@dltech/atlas-core'

import {
  withdrawSettlementsOf,
  type WithdrawIntent,
  type WithdrawSettlement,
} from './withdraw-queue'

const EMPTY: readonly WithdrawIntent[] = []

export type WithdrawStorePersistence = {
  load: () => Promise<readonly unknown[]> | readonly unknown[]
  save: (intents: readonly WithdrawIntent[]) => void
}

export type WithdrawStore = {
  request: (intent: WithdrawIntent) => boolean
  discard: (intent: WithdrawIntent) => void
  intentsOf: (sessionId: string) => readonly WithdrawIntent[]
  takeSettlements: (args: {
    sessionId: string
    events: readonly RecordEvent[]
  }) => readonly WithdrawSettlement[]
  clear: (sessionId: string) => void
  hydrate: (intents: readonly WithdrawIntent[]) => void
  attachPersistence: (persistence: WithdrawStorePersistence) => void
  subscribe: (args: { sessionId: string; listener: () => void }) => () => void
}

const isIntentOf = (value: unknown): value is WithdrawIntent =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as WithdrawIntent).sessionId === 'string' &&
  (value as WithdrawIntent).sessionId.length > 0 &&
  Number.isInteger((value as WithdrawIntent).targetInboxId)

export const validIntentsOf = (values: readonly unknown[]): readonly WithdrawIntent[] =>
  values.filter(isIntentOf)

export const createWithdrawStore = (args?: {
  persistence?: WithdrawStorePersistence | undefined
}): WithdrawStore => {
  const bySession = new Map<string, readonly WithdrawIntent[]>()
  const listeners = new Map<string, Set<() => void>>()
  let persistence = args?.persistence

  const emit = (sessionId: string): void => {
    for (const listener of [...(listeners.get(sessionId) ?? [])]) listener()
  }

  const allIntents = (): readonly WithdrawIntent[] => [...bySession.values()].flat()

  const persist = (): void => {
    if (persistence === undefined) return
    try {
      persistence.save(allIntents())
    } catch {
      return
    }
  }

  const intentsOf = (sessionId: string): readonly WithdrawIntent[] =>
    bySession.get(sessionId) ?? EMPTY

  const replace = (sessionId: string, intents: readonly WithdrawIntent[]): void => {
    if (intents.length === 0) bySession.delete(sessionId)
    else bySession.set(sessionId, intents)
    emit(sessionId)
  }

  const hydrate = (intents: readonly WithdrawIntent[]): void => {
    const changed = new Set<string>()
    for (const intent of validIntentsOf(intents)) {
      const current = intentsOf(intent.sessionId)
      if (current.some((entry) => entry.targetInboxId === intent.targetInboxId)) continue
      bySession.set(intent.sessionId, [...current, intent])
      changed.add(intent.sessionId)
    }
    if (changed.size === 0) return
    for (const sessionId of changed) emit(sessionId)
    persist()
  }

  const attachPersistence = (next: WithdrawStorePersistence): void => {
    persistence = next
    const loaded = next.load()
    if (!(loaded instanceof Promise)) {
      hydrate(validIntentsOf(loaded))
      return
    }
    void loaded.then((intents) => hydrate(validIntentsOf(intents))).catch(() => undefined)
  }

  const store: WithdrawStore = {
    request: (intent) => {
      const current = intentsOf(intent.sessionId)
      if (current.some((entry) => entry.targetInboxId === intent.targetInboxId)) return false
      replace(intent.sessionId, [...current, intent])
      persist()
      return true
    },
    discard: (intent) => {
      const current = intentsOf(intent.sessionId)
      if (!current.some((entry) => entry.targetInboxId === intent.targetInboxId)) return
      replace(
        intent.sessionId,
        current.filter((entry) => entry.targetInboxId !== intent.targetInboxId),
      )
      persist()
    },
    intentsOf,
    takeSettlements: ({ sessionId, events }) => {
      const intents = intentsOf(sessionId)
      const settlements = withdrawSettlementsOf({ intents, events })
      if (settlements.length === 0) return []
      const settled = new Set(settlements.map((entry) => entry.targetInboxId))
      replace(
        sessionId,
        intents.filter((entry) => !settled.has(entry.targetInboxId)),
      )
      persist()
      return settlements
    },
    clear: (sessionId) => {
      if (!bySession.has(sessionId)) return
      replace(sessionId, EMPTY)
      persist()
    },
    hydrate: (intents) => hydrate(intents),
    attachPersistence,
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

  if (args?.persistence !== undefined) attachPersistence(args.persistence)
  return store
}

export const withdrawStore = createWithdrawStore()
