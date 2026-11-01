import type { Row, Tx } from '@dltech/atlas-db'

import type { GithubPrEventMailboxService } from './github-pr-event-mailbox.service'
import { verdictTimingByUser } from './github-pr-event-policy'
import { dischargeHeadVerdict } from './github-pr-head-checks'
import {
  transitionsOf,
  type PrTransitionEvent,
  type PrTransitionSnapshot,
} from './github-pr-event-transitions'
import { EPrEventKind, type GithubPrEventPayload } from './github-realtime.types'

export type PrTransitionWrites = {
  mailbox: GithubPrEventMailboxService
  repoFullName: string
  prNumber: number
  url: string
}

/**
 * One state observation's complete transition delivery: the per-head verdict obligation
 * discharged through the ledger so a settled read announces once per (head, verdict) however the
 * checks got there — zero→green on an unchanged SHA and a first settled observation included —
 * the fail-fast signal for the first failure of a still-running suite (a timing signal, grouped
 * per user policy), and the non-verdict boundaries (mergeability, state), which still require a
 * prior snapshot: a freshly-tracked PR must not replay the state it already had. Event rows carry
 * dedupe keys, so a replayed observation whose rows already exist inserts nothing, and a
 * recipientless observation writes no rows and claims no obligation — the next observation with
 * subscribers discharges it.
 */
export async function deliverPrTransitions(args: {
  writes: PrTransitionWrites
  prior: PrTransitionSnapshot | null
  next: PrTransitionSnapshot | null
  userIds: readonly string[]
  tx: Tx | undefined
}): Promise<void> {
  if (args.next === null) return
  const { writes, prior, next } = args
  if (args.userIds.length === 0) return
  const record = (event: PrTransitionEvent, userIds: readonly string[]) =>
    writes.mailbox.record({
      userIds,
      repoFullName: writes.repoFullName,
      prNumber: writes.prNumber,
      kind: event.kind,
      payload: { ...event.payload, url: writes.url },
      dedupeKey: event.dedupeKey === '' ? undefined : event.dedupeKey,
      tx: args.tx,
    })

  await dischargeHeadVerdict({
    tx: args.tx,
    repoFullName: writes.repoFullName,
    prNumber: writes.prNumber,
    next,
    now: new Date(),
    emitVerdict: async (verdict, eventKey) => {
      const payload: GithubPrEventPayload = {
        url: writes.url,
        verdict,
        headSha: next.headSha,
        settled: true,
      }
      await writes.mailbox.record({
        userIds: args.userIds,
        repoFullName: writes.repoFullName,
        prNumber: writes.prNumber,
        kind: EPrEventKind.Verdict,
        payload,
        dedupeKey: eventKey,
        tx: args.tx,
      })
    },
  })

  if (prior === null) return

  if (next.checksRunning > 0 && prior.checksFailed === 0 && next.checksFailed > 0) {
    const timings = await verdictTimingByUser({ userIds: args.userIds })
    const users = args.userIds.filter(
      (userId) => (timings.get(userId) ?? 'fail-fast') === 'fail-fast',
    )
    if (users.length > 0) {
      await record(
        {
          kind: EPrEventKind.Verdict,
          dedupeKey: [
            writes.repoFullName,
            writes.prNumber,
            next.headSha,
            'verdict',
            'fail-fast',
          ].join(':'),
          payload: {
            url: writes.url,
            verdict: 'failed',
            headSha: next.headSha,
            settled: false,
          },
        },
        users,
      )
    }
  }

  const rest = transitionsOf({
    prior,
    next: { ...next, url: writes.url },
    options: { repoFullName: writes.repoFullName, prNumber: writes.prNumber },
  }).filter((event) => event.kind !== EPrEventKind.Verdict)
  for (const event of rest) await record(event, args.userIds)
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
