import {
  checkoutsOf,
  sessionViewOf,
  type Lease,
  type PluginViewFold,
  type SessionViewState,
  type V2Event,
} from '@dltech/atlas-core'
import { sessionSandboxStatusSchema } from '@dltech/atlas-protocol'
import type { z } from 'zod'

import { UnknownThreadError } from './errors'
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

const digestViewOf = async (args: {
  tx: ControlTx
  sessionId: string
  threadId: string
  state: SessionViewState
  lease: Lease
  live: boolean
  pullRequest: TrackedPullRequestRow | undefined
  sandbox: ControlDigestView['sandbox']
  now: string
  eventSchema?: z.ZodType<V2Event> | undefined
}): Promise<ControlDigestView> => {
  const messageAfterFailure = await messageAfterFailureIn({
    tx: args.tx,
    sessionId: args.sessionId,
    threadId: args.threadId,
    state: args.state,
    eventSchema: args.eventSchema,
  })
  const value = sessionViewOf({
    state: args.state,
    live: args.live,
    queuedSince: null,
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
  eventSchema?: z.ZodType<V2Event> | undefined
  pluginViews?: readonly PluginViewFold[] | undefined
}): Promise<ControlSessionDigest[]> => {
  const { tx, rows } = args
  if (!args.withView || rows.length === 0) {
    return rows.map((row) => ({ ...row, view: null }))
  }
  const threadIds = [...new Set(rows.map((row) => row.mainThreadId))]
  const sessionIds = rows.map((row) => row.sessionId)
  const threads = new Map((await tx.readThreads(threadIds)).map((row) => [row.threadId, row]))
  const views = new Map((await tx.readSessionViews(sessionIds)).map((row) => [row.sessionId, row]))
  const leases = await args.leases.currentLeasesIn({ tx, sessionIds })
  const pullRequests = new Map<string, TrackedPullRequestRow[]>()
  for (const row of await tx.readTrackedPullRequests(sessionIds)) {
    const list = pullRequests.get(row.sessionId)
    if (list === undefined) pullRequests.set(row.sessionId, [row])
    else list.push(row)
  }

  const digests: ControlSessionDigest[] = []
  for (const row of rows) {
    const thread = threads.get(row.mainThreadId)
    if (thread === undefined) throw new UnknownThreadError(row.mainThreadId)
    const cached = usableState(views.get(row.sessionId))
    const state =
      cached !== undefined && cached.at === thread.headSeq
        ? cached
        : await currentViewIn({
            tx,
            sessionId: row.sessionId,
            threadId: row.mainThreadId,
            eventSchema: args.eventSchema,
            pluginViews: args.pluginViews,
          })
    const current = leases.get(row.sessionId)
    if (current === undefined) throw new Error(`missing lease for ${row.sessionId}`)
    const view = await digestViewOf({
      tx,
      sessionId: row.sessionId,
      threadId: row.mainThreadId,
      state,
      lease: current.lease,
      live: current.live,
      pullRequest: pullRequests.get(row.sessionId)?.[0],
      sandbox: sandboxOf(row),
      now: args.now,
      eventSchema: args.eventSchema,
    })
    digests.push({ ...row, view })
  }
  return digests
}
