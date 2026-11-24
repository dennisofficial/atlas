import type { StagedMessage } from './queued-messages'

const EMPTY: readonly StagedMessage[] = []
const EMPTY_CLIENT_IDS: readonly string[] = []

const EMPTY_HANDLED: ReadonlySet<string> = new Set()

const entries = new Map<string, readonly StagedMessage[]>()
const sent = new Map<string, readonly string[]>()
const handled = new Map<string, ReadonlySet<string>>()
const listeners = new Map<string, Set<() => void>>()

const emit = (sessionId: string): void => {
  for (const listener of [...(listeners.get(sessionId) ?? [])]) listener()
}

export const stagedOf = (sessionId: string): readonly StagedMessage[] =>
  entries.get(sessionId) ?? EMPTY

export const sentClientIdsOf = (sessionId: string): readonly string[] =>
  sent.get(sessionId) ?? EMPTY_CLIENT_IDS

export const handledQuickStopsOf = (sessionId: string): ReadonlySet<string> =>
  handled.get(sessionId) ?? EMPTY_HANDLED

export const rememberHandledQuickStops = (args: {
  sessionId: string
  rewindEventIds: readonly string[]
}): void => {
  const current = handledQuickStopsOf(args.sessionId)
  handled.set(args.sessionId, new Set([...current, ...args.rewindEventIds]))
}

export const stageMessage = (args: { sessionId: string; message: StagedMessage }): void => {
  entries.set(args.sessionId, [...stagedOf(args.sessionId), args.message])
  sent.set(args.sessionId, [...sentClientIdsOf(args.sessionId), args.message.clientId])
  emit(args.sessionId)
}

export const settleMessages = (args: {
  sessionId: string
  clientIds: ReadonlySet<string>
}): void => {
  const current = stagedOf(args.sessionId)
  const kept = current.filter((entry) => !args.clientIds.has(entry.clientId))
  if (kept.length === current.length) return
  entries.set(args.sessionId, kept)
  emit(args.sessionId)
}

export const subscribeStaged = (args: {
  sessionId: string
  listener: () => void
}): (() => void) => {
  const held = listeners.get(args.sessionId) ?? new Set<() => void>()
  listeners.set(args.sessionId, held)
  held.add(args.listener)
  return () => {
    held.delete(args.listener)
    if (held.size === 0) listeners.delete(args.sessionId)
  }
}
