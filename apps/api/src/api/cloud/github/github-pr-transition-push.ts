import type { Row } from '@dltech/atlas-db'

import type { GithubPrEventMailboxService } from './github-pr-event-mailbox.service'
import { verdictTimingByUser } from './github-pr-event-policy'
import {
  transitionsOf,
  type PrTransitionSnapshot,
  type PrVerdictTiming,
} from './github-pr-event-transitions'

/**
 * The webhook path is not the only thing that can observe a pull request crossing a boundary:
 * the poll sweeper's REST read stands in for repos where no hook exists. Whoever upserted the
 * state row hands the prior snapshot and the fresh row here, and the same transition diff the
 * webhook delivery runs decides which mailbox rows the subscribers get. A brand-new row (prior
 * null) announces nothing — a freshly-tracked PR must not replay the state it already had.
 */
export async function pushPrTransitions(args: {
  mailbox: GithubPrEventMailboxService
  prior: PrTransitionSnapshot | null
  row: Row<'GithubPrState'>
  userIds: readonly string[]
}): Promise<void> {
  if (args.prior === null || args.userIds.length === 0) return

  const next = snapshotOf(args.row)
  if (next === null) return
  const nextWithUrl = { ...next, url: args.row.url }

  const timings = await verdictTimingByUser({ userIds: args.userIds })
  const byTiming = new Map<PrVerdictTiming, string[]>()
  for (const userId of args.userIds) {
    const timing = timings.get(userId) ?? 'fail-fast'
    const group = byTiming.get(timing) ?? []
    group.push(userId)
    byTiming.set(timing, group)
  }

  for (const [verdictTiming, groupUserIds] of byTiming) {
    for (const event of transitionsOf({
      prior: args.prior,
      next: nextWithUrl,
      options: { verdictTiming },
    })) {
      await args.mailbox.record({
        userIds: groupUserIds,
        repoFullName: args.row.repoFullName,
        prNumber: args.row.prNumber,
        kind: event.kind,
        payload: { ...event.payload, url: args.row.url },
      })
    }
  }
}

export function snapshotOf(row: Row<'GithubPrState'> | null): PrTransitionSnapshot | null {
  if (row === null) return null
  return {
    state: row.state,
    headSha: row.headSha,
    checksRunning: row.checksRunning,
    checksPassed: row.checksPassed,
    checksFailed: row.checksFailed,
    mergeable: row.mergeable,
  }
}
