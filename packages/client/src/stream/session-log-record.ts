import type {
  FailureMessageState,
  PendingInputsState,
  SessionViewState,
  RecordEvent,
  VisibilityState,
} from '@dltech/atlas-core'

import type { QuickStopState } from '../session/quick-stop-state'
import { SESSION_LOG_STRUCTURE_VERSION, type SessionLogSnapshot } from './session-log'
import type { SessionCursor } from './session-window'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const isCursor = (value: unknown): value is SessionCursor =>
  isRecord(value) && typeof value.seq === 'number' && typeof value.hash === 'string'

const isSpan = (value: unknown): boolean =>
  isRecord(value) &&
  typeof value.createdAt === 'number' &&
  typeof value.fromSeq === 'number' &&
  typeof value.throughSeq === 'number' &&
  typeof value.keepSurvivors === 'boolean' &&
  (value.keepTurns === undefined || typeof value.keepTurns === 'boolean')

export const isVisibility = (value: unknown): value is VisibilityState =>
  isRecord(value) && Array.isArray(value.spans) && value.spans.every(isSpan)

const isPending = (value: unknown): value is PendingInputsState =>
  isRecord(value) &&
  Array.isArray(value.pending) &&
  value.pending.every((entry) => isRecord(entry) && typeof entry.inboxId === 'number')

const isFailure = (value: unknown): value is FailureMessageState =>
  isRecord(value) &&
  (value.failureHead === null || typeof value.failureHead === 'number') &&
  typeof value.prepared === 'boolean' &&
  typeof value.afterFailure === 'boolean'

export const isView = (value: unknown): value is SessionViewState =>
  isRecord(value) &&
  typeof value.version === 'number' &&
  typeof value.at === 'number' &&
  isRecord(value.facts) &&
  isRecord(value.meter) &&
  isRecord(value.checkouts) &&
  isRecord(value.spend) &&
  isPending(value.pending) &&
  isFailure(value.failure) &&
  isRecord(value.pluginViews)

const isEventList = (value: unknown): value is readonly RecordEvent[] =>
  Array.isArray(value) && value.every((event) => isRecord(event) && typeof event.seq === 'number')

const isQuickStopMessage = (value: unknown): boolean =>
  isRecord(value) &&
  typeof value.clientId === 'string' &&
  typeof value.text === 'string' &&
  Array.isArray(value.attachments)

const isQuickStopCandidate = (value: unknown): boolean =>
  isRecord(value) && typeof value.seq === 'number' && isQuickStopMessage(value)

const isQuickStopEvidence = (value: unknown): boolean =>
  isRecord(value) &&
  typeof value.rewindEventId === 'string' &&
  Array.isArray(value.messages) &&
  value.messages.every(isQuickStopMessage)

const isQuickStopInbox = (value: unknown): boolean =>
  Array.isArray(value) &&
  value.length === 2 &&
  typeof value[0] === 'number' &&
  typeof value[1] === 'string'

const readQuickStopRecord = (value: unknown): QuickStopState | undefined => {
  if (value === undefined) return undefined
  if (!isRecord(value)) return undefined
  if (!Array.isArray(value.clientIdByInbox) || !value.clientIdByInbox.every(isQuickStopInbox)) {
    return undefined
  }
  if (!Array.isArray(value.candidates) || !value.candidates.every(isQuickStopCandidate)) {
    return undefined
  }
  if (typeof value.lastTurnEndedSeq !== 'number') return undefined
  if (!Array.isArray(value.evidence) || !value.evidence.every(isQuickStopEvidence)) {
    return undefined
  }
  return value as QuickStopState
}

const snapshotOfValue = (value: unknown): SessionLogSnapshot | undefined => {
  if (!isRecord(value)) return undefined
  if (value.version !== SESSION_LOG_STRUCTURE_VERSION) return undefined
  if (!isVisibility(value.visibility) || !isPending(value.pending)) return undefined
  if (!isView(value.view) || !isFailure(value.failureMessage)) return undefined
  if (!isEventList(value.commandLog) || !isEventList(value.durable)) return undefined
  if (typeof value.throughSeq !== 'number') return undefined
  if (value.foldedThrough !== undefined && typeof value.foldedThrough !== 'number') return undefined
  if (value.cursor !== undefined && !isCursor(value.cursor)) return undefined
  const quickStops = readQuickStopRecord(value.quickStops)
  if (value.quickStops !== undefined && quickStops === undefined) return undefined
  return {
    version: value.version,
    cursor: value.cursor,
    visibility: value.visibility,
    pending: value.pending,
    view: value.view,
    failureMessage: value.failureMessage,
    durable: value.durable,
    commandLog: value.commandLog,
    quickStops,
    throughSeq: value.throughSeq,
    foldedThrough: value.foldedThrough,
  }
}

export const logSnapshotOf = (raw: unknown): SessionLogSnapshot | undefined => {
  if (isRecord(raw) && 'snapshot' in raw) {
    const snapshot = snapshotOfValue(raw.snapshot)
    if (snapshot === undefined) return undefined
    const head = isCursor(raw.head) ? raw.head : undefined
    if (head === undefined) return snapshot
    return { ...snapshot, cursor: head }
  }
  return snapshotOfValue(raw)
}
