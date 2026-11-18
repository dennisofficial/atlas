import type { PendingInputsState, VisibilityState } from '@dltech/atlas-core'

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
  typeof value.keepSurvivors === 'boolean'

const isVisibility = (value: unknown): value is VisibilityState =>
  isRecord(value) && Array.isArray(value.spans) && value.spans.every(isSpan)

const isPending = (value: unknown): value is PendingInputsState =>
  isRecord(value) &&
  Array.isArray(value.pending) &&
  value.pending.every((entry) => isRecord(entry) && typeof entry.inboxId === 'number')

const snapshotOfValue = (value: unknown): SessionLogSnapshot | undefined => {
  if (!isRecord(value)) return undefined
  if (value.version !== SESSION_LOG_STRUCTURE_VERSION) return undefined
  if (!isVisibility(value.visibility) || !isPending(value.pending)) return undefined
  if (typeof value.throughSeq !== 'number') return undefined
  if (value.cursor !== undefined && !isCursor(value.cursor)) return undefined
  return {
    version: value.version,
    cursor: value.cursor,
    visibility: value.visibility,
    pending: value.pending,
    throughSeq: value.throughSeq,
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
