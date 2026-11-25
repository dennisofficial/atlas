import {
  checkoutsOf,
  queuedSinceOfInbox,
  sessionViewOf,
  type PluginViewFold,
  type SessionViewState,
  type RecordEvent,
} from '@dltech/atlas-core'
import { sessionSandboxStatusSchema } from '@dltech/atlas-protocol'
import type { z } from 'zod'

import type { LeaseOps } from './lease-ops'
import type {
  ControlDigestView,
  ControlSessionDigest,
  ControlTx,
  SessionDigestRow,
  TrackedPullRequestRow,
} from './port'
import { usableState } from './session-view-ops'
import { currentViewIn, messageAfterFailureIn } from './session-view-read'

export type DigestPhases = {
  transactionMs: number
  digestRowsMs: number
  threadsMs: number
  viewsMs: number
  leasesMs: number
  pullRequestsMs: number
  rowsMs: number
}

export type DigestTimings = {
  phases: DigestPhases
  staleRows: number
  staleMs: number
}

export const emptyDigestTimings = (): DigestTimings => ({
  phases: {
    transactionMs: 0,
    digestRowsMs: 0,
    threadsMs: 0,
    viewsMs: 0,
    leasesMs: 0,
    pullRequestsMs: 0,
    rowsMs: 0,
  },
  staleRows: 0,
  staleMs: 0,
})

export const markDigestPhase = (
  timings: DigestTimings | undefined,
  phase: keyof DigestPhases,
  startedAt: number,
): void => {
  if (timings === undefined) return
  timings.phases[phase] = Math.round(performance.now() - startedAt)
}

const sandboxOf = (row: SessionDigestRow): ControlDigestView['sandbox'] => {
  const parsed = sessionSandboxStatusSchema.safeParse({
    status: row.sandboxStatus,
    at: row.sandboxStatusAt,
  })
  return parsed.success ? parsed.data : null
}

const pullRequestViewOf = (
  row: TrackedPullRequestRow | undefined,
): ControlDigestView['pullRequest'] =>
  row === undefined
    ? null
    : {
        repo: row.repo,
        number: row.number,
        url: row.url,
        state: row.state.state,
        checks: row.state.checks,
        mergeable: row.state.mergeable,
        mergeQueued: row.state.mergeQueued,
        autoMerge: row.state.autoMerge,
      }

const digestViewOf = (args: {
  state: SessionViewState
  live: boolean
  queuedSince: string | null
  pullRequest: TrackedPullRequestRow | undefined
  sandbox: ControlDigestView['sandbox']
  now: string
}): ControlDigestView => {
  const messageAfterFailure = messageAfterFailureIn({ state: args.state })
  const value = sessionViewOf({
    state: args.state,
    live: args.live,
    queuedSince: args.queuedSince,
    messageAfterFailure,
    now: args.now,
  })
  return {
    status: value.status,
    primaryBranch: checkoutsOf(args.state.checkouts).primary?.branch ?? null,
    pullRequest: pullRequestViewOf(args.pullRequest),
    sandbox: args.sandbox,
  }
}

export const withDigestViews = async (args: {
  tx: ControlTx
  leases: LeaseOps
  rows: readonly SessionDigestRow[]
  now: string
  withView: boolean
  timings?: DigestTimings | undefined
  eventSchema?: z.ZodType<RecordEvent> | undefined
  pluginViews?: readonly PluginViewFold[] | undefined
}): Promise<ControlSessionDigest[]> => {
  const { tx, rows } = args
  if (!args.withView || rows.length === 0) {
    return rows.map((row) => ({ ...row, view: null }))
  }
  const stats = args.timings ?? emptyDigestTimings()
  const threadIds = [...new Set(rows.map((row) => row.mainThreadId))]
  const sessionIds = rows.map((row) => row.sessionId)
  let startedAt = performance.now()
  const threads = new Map((await tx.readThreads(threadIds)).map((row) => [row.threadId, row]))
  markDigestPhase(stats, 'threadsMs', startedAt)
  startedAt = performance.now()
  const views = new Map((await tx.readSessionViews(sessionIds)).map((row) => [row.sessionId, row]))
  markDigestPhase(stats, 'viewsMs', startedAt)
  startedAt = performance.now()
  const leases = await args.leases.currentLeasesIn({ tx, sessionIds })
  markDigestPhase(stats, 'leasesMs', startedAt)
  startedAt = performance.now()
  const queuedSince = new Map(
    (await tx.firstUnconsumedMessages({ sessionIds })).map((entry) => [
      entry.sessionId,
      queuedSinceOfInbox([entry]),
    ]),
  )
  const pullRequests = new Map<string, TrackedPullRequestRow[]>()
  for (const row of await tx.readTrackedPullRequests(sessionIds)) {
    const list = pullRequests.get(row.sessionId)
    if (list === undefined) pullRequests.set(row.sessionId, [row])
    else list.push(row)
  }
  markDigestPhase(stats, 'pullRequestsMs', startedAt)

  let staleRows = 0
  let staleMs = 0
  const loopStartedAt = performance.now()
  const digests: ControlSessionDigest[] = []
  for (const row of rows) {
    const thread = threads.get(row.mainThreadId)
    if (thread === undefined) {
      digests.push({ ...row, view: null })
      continue
    }
    const cached = usableState(views.get(row.sessionId))
    const cachedIsCurrent = cached !== undefined && cached.at === thread.headSeq
    const viewStartedAt = performance.now()
    const state = cachedIsCurrent
      ? cached
      : await currentViewIn({
          tx,
          sessionId: row.sessionId,
          threadId: row.mainThreadId,
          eventSchema: args.eventSchema,
          pluginViews: args.pluginViews,
        })
    if (!cachedIsCurrent) {
      staleRows += 1
      staleMs += performance.now() - viewStartedAt
    }
    const view = digestViewOf({
      state,
      live: leases.get(row.sessionId)?.live ?? false,
      queuedSince: queuedSince.get(row.sessionId) ?? null,
      pullRequest: pullRequests.get(row.sessionId)?.[0],
      sandbox: sandboxOf(row),
      now: args.now,
    })
    digests.push({ ...row, view })
  }
  stats.phases.rowsMs = Math.round(performance.now() - loopStartedAt)
  stats.staleRows = staleRows
  stats.staleMs = Math.round(staleMs)
  return digests
}
