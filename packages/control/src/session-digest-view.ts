import type { LeaseOps } from './lease-ops'
import type { ControlDigestView, ControlSessionDigest, ControlTx, SessionDigestRow } from './port'
import { currentViewIn, liveViewIn, pullRequestsWithState } from './session-view-read'
import { checkoutsOf, type V2Event } from '@dltech/atlas-core'
import type { z } from 'zod'

const digestViewIn = async (args: {
  tx: ControlTx
  leases: LeaseOps
  row: SessionDigestRow
  now: string
  eventSchema?: z.ZodType<V2Event> | undefined
}): Promise<ControlDigestView> => {
  const { tx, row } = args
  const state = await currentViewIn({
    tx,
    sessionId: row.sessionId,
    threadId: row.mainThreadId,
    eventSchema: args.eventSchema,
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
  const latest = live.value.pullRequests.at(-1)
  const [pullRequest] =
    latest === undefined ? [] : await pullRequestsWithState({ tx, links: [latest] })
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
            state: pullRequest.state?.state ?? null,
            checks: pullRequest.state?.checks ?? null,
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
}): Promise<ControlSessionDigest[]> => {
  const digests: ControlSessionDigest[] = []
  for (const row of args.rows) {
    const view = args.withView ? await digestViewIn({ ...args, row }) : null
    digests.push({ ...row, view })
  }
  return digests
}
