import {
  AGENT37_POD_SHAPES,
  AGENT37_SANDBOX_PROVIDER,
  messageAfterFailureOf,
  type PodShape,
  podSizingOf,
  SANDBOX_MEMORY_GB_PER_VCPU,
  sessionViewOf,
  setupRunningOf,
  type Lease,
  type PendingInputsState,
  type PluginViewFold,
  type SessionStatus,
  type SessionViewState,
  type SessionViewValue,
  type V2Event,
} from '@dltech/atlas-core'
import {
  sessionSandboxStatusSchema,
  type PodShapeViewOutput,
  type SessionCommandRow,
  type SessionStatusOutput,
  type SessionSubscription,
} from '@dltech/atlas-protocol'

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
import { ensureSessionViewIn, usableState } from './session-view-ops'
import { listSubscriptionsIn } from './subscription-ops'

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
  subscriptions: SessionSubscription[]
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

export const messageAfterFailureIn = (args: { state: SessionViewState }): boolean =>
  messageAfterFailureOf(args.state.failure)

export type LiveView = {
  value: SessionViewValue
  lease: Lease
  live: boolean
  setupRunning: boolean
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
    messageAfterFailure: messageAfterFailureIn({ state }),
    now: args.now,
  })
  return {
    value,
    lease,
    live,
    setupRunning: setupRunningOf({ run: state.facts.setupRun, now: args.now }),
  }
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

const shapeOf = (row: { vcpus: number | null; memoryGb: number | null }): PodShape | undefined =>
  row.vcpus === null || row.memoryGb === null
    ? undefined
    : { vcpus: row.vcpus, memoryGb: row.memoryGb }

const exactMemoryOf = (args: { sandboxProvider: string; vcpus: number }): number | null => {
  if (args.sandboxProvider !== AGENT37_SANDBOX_PROVIDER) {
    return args.vcpus * SANDBOX_MEMORY_GB_PER_VCPU
  }
  const memories = new Set(
    AGENT37_POD_SHAPES.filter((shape) => shape.vcpus === args.vcpus).map((shape) => shape.memoryGb),
  )
  return memories.size === 1 ? ([...memories][0] ?? null) : null
}

const actualShapeOf = (session: ControlSessionRow): PodShapeViewOutput | undefined => {
  if (session.podActualVcpus === null) return undefined
  return {
    vcpus: session.podActualVcpus,
    memoryGb:
      session.podActualMemoryGb ??
      exactMemoryOf({ sandboxProvider: session.sandboxProvider, vcpus: session.podActualVcpus }),
  }
}

export const podStatusOf = (session: ControlSessionRow | undefined): SessionStatusOutput['pod'] => {
  if (session === undefined) return undefined
  const actual = actualShapeOf(session)
  const desired = shapeOf({ vcpus: session.podDesiredVcpus, memoryGb: session.podDesiredMemoryGb })
  const pending =
    desired !== undefined && session.podAppliedGeneration !== session.podSizeGeneration
  const phase =
    session.podResizeError !== null
      ? 'failed'
      : session.podWaitingSince !== null
        ? 'waiting'
        : pending
          ? 'resizing'
          : 'steady'
  return {
    ...(actual === undefined ? {} : { shape: actual, actualVcpus: actual.vcpus }),
    ...(desired === undefined ? {} : { desiredShape: desired, desiredVcpus: desired.vcpus }),
    phase,
    ...(session.podResizeError === null ? {} : { error: session.podResizeError }),
    sizing: podSizingOf({ sandboxProvider: session.sandboxProvider }),
  }
}

const sandboxOf = (session: ControlSessionRow | undefined): SessionStatusOutput['sandbox'] => {
  if (session === undefined || session.sandboxStatus === null) return undefined
  if (session.sandboxStatusAt === null) return undefined
  const parsed = sessionSandboxStatusSchema.safeParse({
    status: session.sandboxStatus,
    at: session.sandboxStatusAt,
    ...(session.sandboxStatusReason === null ? {} : { reason: session.sandboxStatusReason }),
  })
  return parsed.success ? parsed.data : undefined
}

const sandboxChoiceOf = (
  session: ControlSessionRow | undefined,
): Pick<SessionStatusOutput, 'sandboxProvider' | 'credentialSource'> => {
  if (session === undefined) return {}
  return {
    sandboxProvider: session.sandboxProvider as SessionStatusOutput['sandboxProvider'],
    credentialSource: session.credentialSource as SessionStatusOutput['credentialSource'],
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
  const sandbox = sandboxOf(args.session)
  const { status } = live.value
  const queued = queuedOf(args.pending)
  const commands = [...args.running, ...commandsOf(args.pending)]
  return {
    state: status.state,
    ...(status.reason === undefined ? {} : { reason: status.reason }),
    ...(status.since === undefined ? {} : { since: status.since }),
    ...(live.setupRunning ? { setupRunning: true } : {}),
    lease: { epoch: live.lease.epoch, holderHostId: live.lease.holderHostId, live: live.live },
    ...(sandbox === undefined ? {} : { sandbox }),
    ...sandboxChoiceOf(args.session),
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
      subscriptions: await listSubscriptionsIn({ tx, sessionId }),
    },
  }
}

export type SessionBusyRead = {
  at: number
  status: SessionStatus
  setupRunning: boolean
  pluginViews: Readonly<Record<string, unknown>>
}

export const readSessionBusyIn = async (args: {
  tx: ControlTx
  leases: LeaseOps
  sessionId: string
  threadId: string
  now: string
}): Promise<SessionBusyRead | undefined> => {
  const { tx, sessionId, threadId } = args
  const row = await tx.readThread(threadId)
  if (row === undefined) throw new UnknownThreadError(threadId)
  const state = usableState(await tx.readSessionView(sessionId))
  if (state === undefined || state.at !== row.headSeq) return undefined
  const live = await liveViewIn({ ...args, state })
  return {
    at: state.at,
    status: live.value.status,
    setupRunning: live.setupRunning,
    pluginViews: live.value.pluginViews,
  }
}

const VIEW_READ_ATTEMPTS = 5

type CatchUpArgs<T> = {
  store: ControlStorePort
  sessionId: string
  threadId: string
  eventSchema?: z.ZodType<V2Event> | undefined
  pluginViews?: readonly PluginViewFold[] | undefined
  readIn: (tx: ControlTx) => Promise<T | undefined>
}

const withCatchUp = async <T>(args: CatchUpArgs<T>): Promise<T> => {
  const { store, sessionId, threadId } = args
  for (let attempt = 0; attempt < VIEW_READ_ATTEMPTS; attempt += 1) {
    const read = await store.transact(async (tx) => {
      await tx.useSnapshot()
      return args.readIn(tx)
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

export const readSessionViewWithCatchUp = (args: {
  store: ControlStorePort
  leases: LeaseOps
  nowIn: (tx: ControlTx) => Promise<string>
  sessionId: string
  threadId: string
  eventSchema?: z.ZodType<V2Event> | undefined
  pluginViews?: readonly PluginViewFold[] | undefined
}): Promise<SessionViewRead> =>
  withCatchUp({
    ...args,
    readIn: async (tx) =>
      readSessionViewIn({
        tx,
        leases: args.leases,
        sessionId: args.sessionId,
        threadId: args.threadId,
        now: await args.nowIn(tx),
        eventSchema: args.eventSchema,
      }),
  })

export const readSessionBusyWithCatchUp = (args: {
  store: ControlStorePort
  leases: LeaseOps
  nowIn: (tx: ControlTx) => Promise<string>
  sessionId: string
  threadId: string
  eventSchema?: z.ZodType<V2Event> | undefined
  pluginViews?: readonly PluginViewFold[] | undefined
}): Promise<SessionBusyRead> =>
  withCatchUp({
    ...args,
    readIn: async (tx) =>
      readSessionBusyIn({
        tx,
        leases: args.leases,
        sessionId: args.sessionId,
        threadId: args.threadId,
        now: await args.nowIn(tx),
      }),
  })
