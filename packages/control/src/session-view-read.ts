import {
  activeFailure,
  activeStartFailure,
  sessionViewOf,
  type Lease,
  type PendingInputsState,
  type PluginViewFold,
  type SessionViewState,
  type SessionViewValue,
  type V2Event,
} from '@dltech/atlas-core'
import type { SessionCommandRow, SessionStatusOutput } from '@dltech/atlas-protocol'
import type { z } from 'zod'

import { UnknownThreadError } from './errors'
import type { LeaseOps } from './lease-ops'
import type {
  ControlSessionRow,
  ControlStorePort,
  ControlTx,
  PrChecks,
  TrackedPullRequestRow,
} from './port'
import { runningCommandsIn } from './command-rows'
import { commandsOf, queuedOf } from './queued-messages'
import { readEventsIn } from './read-events'
import { ensureSessionViewIn, usableState, VIEW_TAIL_LIMIT } from './session-view-ops'

export type ControlPullRequestState = {
  title: string
  state: string
  headSha: string
  checks: PrChecks
  mergeable: boolean | null
  mergeQueued: boolean
  autoMerge: boolean
  updatedAt: string
}

export type ControlPullRequest = {
  repo: string
  number: number
  url: string
  branch: string
  state: ControlPullRequestState
}

export type ControlSessionViewValue = Omit<SessionViewValue, 'status' | 'pullRequests'> & {
  status: SessionStatusOutput
  pullRequests: ControlPullRequest[]
}

export type SessionViewRead = { at: number; value: ControlSessionViewValue }

export const currentViewIn = async (args: {
  tx: ControlTx
  sessionId: string
  threadId: string
  eventSchema?: z.ZodType<V2Event> | undefined
  pluginViews?: readonly PluginViewFold[] | undefined
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

export const messageAfterFailureIn = async (args: {
  tx: ControlTx
  sessionId: string
  threadId: string
  state: SessionViewState
  eventSchema?: z.ZodType<V2Event> | undefined
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
    eventSchema: args.eventSchema,
  })
  const failure = activeStartFailure(page.events) ?? activeFailure(page.events)
  if (failure === undefined) return false
  return page.events.some(
    (event) =>
      (event.type === 'user-said' || event.type === 'input-posted') &&
      event.inboxId !== undefined &&
      event.inboxId > failure.inboxHead,
  )
}

export type LiveView = {
  value: SessionViewValue
  lease: Lease
  live: boolean
}

export const liveViewIn = async (args: {
  tx: ControlTx
  leases: LeaseOps
  sessionId: string
  threadId: string
  state: SessionViewState
  now: string
  eventSchema?: z.ZodType<V2Event> | undefined
}): Promise<LiveView> => {
  const { tx, sessionId, state } = args
  const { lease, live } = await args.leases.currentLeaseIn({ tx, sessionId })
  const value = sessionViewOf({
    state,
    live,
    queuedSince: null,
    messageAfterFailure: await messageAfterFailureIn(args),
    now: args.now,
  })
  return { value, lease, live }
}

const pullRequestOf = (row: TrackedPullRequestRow): ControlPullRequest => ({
  repo: row.repo,
  number: row.number,
  url: row.url,
  branch: row.branch,
  state: {
    title: row.state.title,
    state: row.state.state,
    headSha: row.state.headSha,
    checks: row.state.checks,
    mergeable: row.state.mergeable,
    mergeQueued: row.state.mergeQueued,
    autoMerge: row.state.autoMerge,
    updatedAt: row.state.updatedAt,
  },
})

export const trackedPullRequestsOf = async (args: {
  tx: ControlTx
  sessionId: string
}): Promise<ControlPullRequest[]> => {
  const rows = await args.tx.readTrackedPullRequests([args.sessionId])
  return rows.map(pullRequestOf)
}

export const podStatusOf = (session: ControlSessionRow | undefined): SessionStatusOutput['pod'] => {
  if (session === undefined) return undefined
  const desiredVcpus = session.podDesiredVcpus ?? undefined
  const actualVcpus = session.podActualVcpus ?? undefined
  if (desiredVcpus === undefined && actualVcpus === undefined) return undefined
  const pending =
    desiredVcpus !== undefined && session.podAppliedGeneration !== session.podSizeGeneration
  const phase = session.podResizeError !== null ? 'failed' : pending ? 'resizing' : 'steady'
  return {
    ...(desiredVcpus === undefined ? {} : { desiredVcpus }),
    ...(actualVcpus === undefined ? {} : { actualVcpus }),
    phase,
    ...(session.podResizeError === null ? {} : { error: session.podResizeError }),
  }
}

export const statusOutputOf = (args: {
  live: LiveView
  pending: PendingInputsState
  running: readonly SessionCommandRow[]
  session: ControlSessionRow | undefined
}): SessionStatusOutput => {
  const { live } = args
  const pod = podStatusOf(args.session)
  const { status } = live.value
  const queued = queuedOf(args.pending)
  const commands = [...args.running, ...commandsOf(args.pending)]
  return {
    state: status.state,
    ...(status.reason === undefined ? {} : { reason: status.reason }),
    ...(status.since === undefined ? {} : { since: status.since }),
    lease: { epoch: live.lease.epoch, holderHostId: live.lease.holderHostId, live: live.live },
    ...(queued.length === 0 ? {} : { queued }),
    ...(commands.length === 0 ? {} : { commands }),
    ...(pod === undefined ? {} : { pod }),
  }
}

export const readSessionViewIn = async (args: {
  tx: ControlTx
  leases: LeaseOps
  sessionId: string
  threadId: string
  now: string
  eventSchema?: z.ZodType<V2Event> | undefined
}): Promise<SessionViewRead | undefined> => {
  const { tx, sessionId, threadId } = args
  const row = await tx.readThread(threadId)
  if (row === undefined) throw new UnknownThreadError(threadId)
  const state = usableState(await tx.readSessionView(sessionId))
  if (state === undefined || state.at !== row.headSeq) return undefined
  const live = await liveViewIn({ ...args, state })
  return {
    at: state.at,
    value: {
      ...live.value,
      status: statusOutputOf({
        live,
        pending: state.pending,
        running: await runningCommandsIn({
          tx,
          sessionId,
          threadId,
          eventSchema: args.eventSchema,
        }),
        session: await tx.readSession({ sessionId }),
      }),
      pullRequests: await trackedPullRequestsOf({ tx, sessionId }),
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
  eventSchema?: z.ZodType<V2Event> | undefined
  pluginViews?: readonly PluginViewFold[] | undefined
}): Promise<SessionViewRead> => {
  const { store, sessionId, threadId } = args
  for (let attempt = 0; attempt < VIEW_READ_ATTEMPTS; attempt += 1) {
    const read = await store.transact(async (tx) => {
      await tx.useSnapshot()
      return readSessionViewIn({
        tx,
        leases: args.leases,
        sessionId,
        threadId,
        now: await args.nowIn(tx),
        eventSchema: args.eventSchema,
      })
    })
    if (read !== undefined) return read
    await store.transact(async (tx) => {
      if ((await tx.lockThread(threadId)) === undefined) throw new UnknownThreadError(threadId)
      await ensureSessionViewIn({
        tx,
        sessionId,
        threadId,
        eventSchema: args.eventSchema,
        pluginViews: args.pluginViews,
      })
    })
  }
  throw new Error(`session view of ${sessionId} kept changing under the read`)
}
