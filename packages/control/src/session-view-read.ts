import {
  activeFailure,
  activeStartFailure,
  INBOX_KIND_STOP,
  sessionViewOf,
  type InboxEntry,
  type Lease,
  type PullRequestLink,
  type SessionViewState,
  type SessionViewValue,
} from '@dltech/atlas-core'
import type { SessionStatusOutput } from '@dltech/atlas-protocol'

import { UnknownThreadError } from './errors'
import type { LeaseOps } from './lease-ops'
import type { ControlStorePort, ControlTx, PrChecks, PrStateRow } from './port'
import { queuedOf } from './queued-messages'
import { readEventsIn } from './read-events'
import { ensureSessionViewIn, usableState, VIEW_TAIL_LIMIT } from './session-view-ops'

export const PENDING_INBOX_READ_LIMIT = 100

export type ControlPullRequestState = {
  title: string
  state: string
  headSha: string
  checks: PrChecks
  mergeable: boolean | null
  updatedAt: string
}

export type ControlPullRequest = PullRequestLink & { state: ControlPullRequestState | null }

export type ControlSessionViewValue = Omit<SessionViewValue, 'status' | 'pullRequests'> & {
  status: SessionStatusOutput
  pullRequests: ControlPullRequest[]
}

export type SessionViewRead = { at: number; value: ControlSessionViewValue }

export const currentViewIn = async (args: {
  tx: ControlTx
  sessionId: string
  threadId: string
}): Promise<SessionViewState> => {
  const { tx, sessionId, threadId } = args
  const row = await tx.readThread(threadId)
  if (row === undefined) throw new UnknownThreadError(threadId)
  const state = usableState(await tx.readSessionView(sessionId))
  if (state !== undefined && state.at === row.headSeq) return state
  await tx.lockThread(threadId)
  return (await ensureSessionViewIn(args)).state
}

const failureMayBeActive = (state: SessionViewState): boolean =>
  state.facts.startFailure !== null ||
  (state.facts.prepareFailure !== null && !state.facts.prepared)

const messageAfterFailureIn = async (args: {
  tx: ControlTx
  sessionId: string
  threadId: string
  state: SessionViewState
}): Promise<boolean> => {
  const { tx } = args
  if (!failureMayBeActive(args.state)) return false
  const row = await tx.readThread(args.threadId)
  if (row === undefined) return false
  const page = await readEventsIn({
    tx,
    row,
    afterSeq: Math.max(0, row.headSeq - VIEW_TAIL_LIMIT),
    limit: VIEW_TAIL_LIMIT,
    visible: true,
  })
  const failure = activeStartFailure(page.events) ?? activeFailure(page.events)
  if (failure === undefined) return false
  const later = await tx.readInboxEntries({
    sessionId: args.sessionId,
    afterId: failure.inboxHead,
    limit: 1,
    excludeKind: INBOX_KIND_STOP,
  })
  return later.length > 0
}

export type LiveView = {
  value: SessionViewValue
  lease: Lease
  live: boolean
  pending: InboxEntry[]
}

export const liveViewIn = async (args: {
  tx: ControlTx
  leases: LeaseOps
  sessionId: string
  threadId: string
  state: SessionViewState
  now: string
}): Promise<LiveView> => {
  const { tx, sessionId, state } = args
  const pending = await tx.readInboxEntries({
    sessionId,
    afterId: 0,
    limit: PENDING_INBOX_READ_LIMIT,
  })
  const { lease, live } = await args.leases.currentLeaseIn({ tx, sessionId })
  const value = sessionViewOf({
    state,
    live,
    unconsumedInbox: pending.length > 0,
    messageAfterFailure: await messageAfterFailureIn(args),
    now: args.now,
  })
  return { value, lease, live, pending }
}

const stateOfRow = (row: PrStateRow): ControlPullRequestState => ({
  title: row.title,
  state: row.state,
  headSha: row.headSha,
  checks: { running: row.checksRunning, passed: row.checksPassed, failed: row.checksFailed },
  mergeable: row.mergeable,
  updatedAt: row.updatedAt,
})

export const pullRequestsWithState = async (args: {
  tx: ControlTx
  links: readonly PullRequestLink[]
}): Promise<ControlPullRequest[]> => {
  if (args.links.length === 0) return []
  const rows = await args.tx.readPrStates(args.links)
  return args.links.map((link) => {
    const row = rows.find((kept) => kept.repo === link.repo && kept.number === link.number)
    return { ...link, state: row === undefined ? null : stateOfRow(row) }
  })
}

export const statusOutputOf = (live: LiveView): SessionStatusOutput => {
  const { status } = live.value
  const queued = queuedOf(live.pending)
  return {
    state: status.state,
    ...(status.reason === undefined ? {} : { reason: status.reason }),
    ...(status.since === undefined ? {} : { since: status.since }),
    lease: { epoch: live.lease.epoch, holderHostId: live.lease.holderHostId, live: live.live },
    ...(queued.length === 0 ? {} : { queued }),
  }
}

export const readSessionViewIn = async (args: {
  tx: ControlTx
  leases: LeaseOps
  sessionId: string
  threadId: string
  now: string
}): Promise<SessionViewRead | undefined> => {
  const { tx, sessionId, threadId } = args
  await tx.useSnapshot()
  const row = await tx.readThread(threadId)
  if (row === undefined) throw new UnknownThreadError(threadId)
  const state = usableState(await tx.readSessionView(sessionId))
  if (state === undefined || state.at !== row.headSeq) return undefined
  const live = await liveViewIn({ ...args, state })
  return {
    at: state.at,
    value: {
      ...live.value,
      status: statusOutputOf(live),
      pullRequests: await pullRequestsWithState({ tx, links: live.value.pullRequests }),
    },
  }
}

const VIEW_READ_ATTEMPTS = 5

export const readSessionViewWithCatchUp = async (args: {
  store: ControlStorePort
  leases: LeaseOps
  nowIn: (tx: ControlTx) => Promise<string>
  sessionId: string
  threadId: string
}): Promise<SessionViewRead> => {
  const { store, sessionId, threadId } = args
  for (let attempt = 0; attempt < VIEW_READ_ATTEMPTS; attempt += 1) {
    const read = await store.transact(async (tx) =>
      readSessionViewIn({
        tx,
        leases: args.leases,
        sessionId,
        threadId,
        now: await args.nowIn(tx),
      }),
    )
    if (read !== undefined) return read
    await store.transact(async (tx) => {
      if ((await tx.lockThread(threadId)) === undefined) throw new UnknownThreadError(threadId)
      await ensureSessionViewIn({ tx, sessionId, threadId })
    })
  }
  throw new Error(`session view of ${sessionId} kept changing under the read`)
}
