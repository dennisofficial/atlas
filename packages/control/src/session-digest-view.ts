import type { LeaseOps } from './lease-ops'
import type { ControlDigestView, ControlSessionDigest, ControlTx, SessionDigestRow } from './port'
import { currentViewIn, liveViewIn, trackedPullRequestsOf } from './session-view-read'
import { checkoutsOf, type PluginViewFold, type V2Event } from '@dltech/atlas-core'
import type { z } from 'zod'

const digestViewIn = async (args: {
  tx: ControlTx
  leases: LeaseOps
  row: SessionDigestRow
  now: string
  eventSchema?: z.ZodType<V2Event> | undefined
  pluginViews?: readonly PluginViewFold[] | undefined
}): Promise<ControlDigestView> => {
  const { tx, row } = args
  const state = await currentViewIn({
    tx,
    sessionId: row.sessionId,
    threadId: row.mainThreadId,
    eventSchema: args.eventSchema,
    pluginViews: args.pluginViews,
  })
  const live = await liveViewIn({
    tx,
    leases: args.leases,
    sessionId: row.sessionId,
    threadId: row.mainThreadId,
    state,
    now: args.now,
    eventSchema: args.eventSchema,
  })
  const [pullRequest] = await trackedPullRequestsOf({ tx, sessionId: row.sessionId })
  return {
    status: live.value.status,
    primaryBranch: checkoutsOf(state.checkouts).primary?.branch ?? null,
    pullRequest:
      pullRequest === undefined
        ? null
        : {
            repo: pullRequest.repo,
            number: pullRequest.number,
            url: pullRequest.url,
            state: pullRequest.state.state,
            checks: pullRequest.state.checks,
            mergeable: pullRequest.state.mergeable,
          },
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
  const digests: ControlSessionDigest[] = []
  for (const row of args.rows) {
    const view = args.withView ? await digestViewIn({ ...args, row }) : null
    digests.push({ ...row, view })
  }
  return digests
}
