import type { InboxEntry, Lease } from '@dltech/atlas-core'

import type { BlobRow, ControlSessionRow, StoredEvent, ThreadRow } from '../../port'

export type SessionRow = ControlSessionRow & { nextInboxId: number }

export type State = {
  sessions: Map<string, SessionRow>
  threads: Map<string, ThreadRow>
  events: Map<string, StoredEvent[]>
  eventIds: Set<string>
  leases: Map<string, Lease>
  inbox: Map<string, InboxEntry[]>
  blobs: Map<string, BlobRow>
  blobRefs: Set<string>
  notifications: string[]
}

const PREPARE_HISTORY_TYPES: ReadonlySet<string> = new Set([
  'workspace-prepared',
  'user-said',
  'workspace-prepare-failed',
  'session-start-failed',
])

export const refKey = (params: { sessionId: string; hash: string }): string =>
  `${params.sessionId}${params.hash}`

export const emptyState = (): State => ({
  sessions: new Map(),
  threads: new Map(),
  events: new Map(),
  eventIds: new Set(),
  leases: new Map(),
  inbox: new Map(),
  blobs: new Map(),
  blobRefs: new Set(),
  notifications: [],
})

export const cloneState = (state: State): State => ({
  sessions: new Map([...state.sessions].map(([key, value]) => [key, { ...value }])),
  threads: new Map([...state.threads].map(([key, value]) => [key, { ...value }])),
  events: new Map([...state.events].map(([key, value]) => [key, [...value]])),
  eventIds: new Set(state.eventIds),
  leases: new Map([...state.leases].map(([key, value]) => [key, { ...value }])),
  inbox: new Map([...state.inbox].map(([key, value]) => [key, value.map((e) => ({ ...e }))])),
  blobs: new Map([...state.blobs].map(([key, value]) => [key, { ...value }])),
  blobRefs: new Set(state.blobRefs),
  notifications: [...state.notifications],
})

export const hasPrepareHistory = (log: readonly StoredEvent[]): boolean =>
  log.some((event) => PREPARE_HISTORY_TYPES.has(event.type))

const inboxHeadOf = (event: StoredEvent): number =>
  (JSON.parse(event.canonical) as { inboxHead: number }).inboxHead

const START_FAILURE_ENDERS: ReadonlySet<string> = new Set([
  'user-said',
  'assistant-said',
  'workspace-prepared',
  'workspace-prepare-failed',
  'run-failed',
])

const activePrepareFailureOf = (log: readonly StoredEvent[]): number | undefined => {
  if (log.some((event) => event.type === 'workspace-prepared' || event.type === 'user-said')) {
    return undefined
  }
  const failed = log.findLast((event) => event.type === 'workspace-prepare-failed')
  return failed === undefined ? undefined : inboxHeadOf(failed)
}

const activeStartFailureOf = (log: readonly StoredEvent[]): number | undefined => {
  const index = log.findLastIndex((event) => event.type === 'session-start-failed')
  const failed = log[index]
  if (failed === undefined) return undefined
  if (log.slice(index + 1).some((event) => START_FAILURE_ENDERS.has(event.type))) return undefined
  return inboxHeadOf(failed)
}

export const activeFailureOf = (log: readonly StoredEvent[]): { inboxHead: number } | undefined => {
  const heads = [activePrepareFailureOf(log), activeStartFailureOf(log)].filter(
    (head): head is number => head !== undefined,
  )
  return heads.length === 0 ? undefined : { inboxHead: Math.max(...heads) }
}
