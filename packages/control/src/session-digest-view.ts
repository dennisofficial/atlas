import type { LeaseOps } from './lease-ops'
import type { ControlDigestView, ControlSessionDigest, ControlTx, SessionDigestRow } from './port'
import { currentViewIn, liveViewIn, pullRequestsWithState } from './session-view-read'
import { checkoutsOf } from '@dltech/atlas-core'

const digestViewIn = async (args: {
  tx: ControlTx
  leases: LeaseOps
  row: SessionDigestRow
  now: string
}): Promise<ControlDigestView> => {
  const { tx, row } = args
  const state = await currentViewIn({ tx, sessionId: row.sessionId, threadId: row.mainThreadId })
  const live = await liveViewIn({
    tx,
    leases: args.leases,
    sessionId: row.sessionId,
    threadId: row.mainThreadId,
    state,
    now: args.now,
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
}): Promise<ControlSessionDigest[]> => {
  const digests: ControlSessionDigest[] = []
  for (const row of args.rows) {
    const view = args.withView ? await digestViewIn({ ...args, row }) : null
    digests.push({ ...row, view })
  }
  return digests
}
