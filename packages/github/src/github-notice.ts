import { endSubscriptionsIn } from '@dltech/atlas-control'
import { controlTxOf, postInboxEntryIn } from '@dltech/atlas-control/postgres'
import {
  EPrEventKind as ECorePrEventKind,
  EPrReviewState,
  EPrVerdict,
  EPullRequestState,
  ESubscriptionActor,
  ESubscriptionEnd,
  INBOX_KIND_EVENT,
  inboxEventPayloadOf,
  type EventBody,
} from '@dltech/atlas-core'
import type { Row, Tx } from '@dltech/atlas-db'
import { z } from 'zod'

import { subscriptionLiveWhere } from './github-delivery-routing'
import { wantsPrEvent } from './github-event-filter'
import { repoPattern } from './github-pr-identity'
import { EPrEventKind as EApiPrEventKind, type GithubPrEventPayload } from './github-realtime.types'

type PrEventDraft = Extract<EventBody, { type: 'pr-event' }>

type Tally = Pick<
  Row<'GithubPrState'>,
  'checksPassed' | 'checksFailed' | 'checksRunning' | 'baseBranch' | 'mergeQueued'
>

const CORE_KIND: Record<EApiPrEventKind, ECorePrEventKind> = {
  [EApiPrEventKind.Comment]: ECorePrEventKind.Comment,
  [EApiPrEventKind.Review]: ECorePrEventKind.Review,
  [EApiPrEventKind.ReviewComment]: ECorePrEventKind.ReviewComment,
  [EApiPrEventKind.Verdict]: ECorePrEventKind.Verdict,
  [EApiPrEventKind.Mergeability]: ECorePrEventKind.Mergeability,
  [EApiPrEventKind.State]: ECorePrEventKind.State,
}

const reviewStateOf = (value: string | undefined): EPrReviewState | undefined => {
  const parsed = z.enum(EPrReviewState).safeParse(value)
  return parsed.success ? parsed.data : undefined
}

const verdictOf = (value: 'green' | 'failed' | undefined): EPrVerdict | undefined => {
  const parsed = z.enum(EPrVerdict).safeParse(value)
  return parsed.success ? parsed.data : undefined
}

const checksOf = (tally: Tally | null): PrEventDraft['checks'] =>
  tally === null
    ? undefined
    : {
        passed: tally.checksPassed,
        failed: tally.checksFailed,
        running: tally.checksRunning,
      }

export const prEventBodyOf = (args: {
  event: Row<'GithubPrEvent'>
  tally: Tally | null
}): PrEventDraft => {
  const payload = args.event.payload as GithubPrEventPayload
  const reviewState = reviewStateOf(payload.reviewState)
  const verdict = verdictOf(payload.verdict)
  const checks = checksOf(args.tally)
  const baseBranch = args.tally?.baseBranch ?? ''
  const stillQueued = verdict === EPrVerdict.Failed && args.tally?.mergeQueued === true
  return {
    type: 'pr-event',
    repo: `github.com/${args.event.repoFullName}`,
    prNumber: args.event.prNumber,
    kind: CORE_KIND[args.event.kind as EApiPrEventKind],
    url: payload.url,
    eventId: args.event.id,
    ...(payload.authorLogin === undefined ? {} : { authorLogin: payload.authorLogin }),
    ...(payload.body === undefined ? {} : { body: payload.body }),
    ...(verdict === undefined ? {} : { verdict }),
    ...(payload.headSha === undefined ? {} : { headSha: payload.headSha }),
    ...(payload.edited === true ? { edited: true } : {}),
    ...(payload.settled === undefined ? {} : { settled: payload.settled }),
    ...(payload.failedChecks === undefined ? {} : { failedChecks: payload.failedChecks }),
    ...(payload.mergeable === undefined ? {} : { mergeable: payload.mergeable }),
    ...(payload.mergeable === false && baseBranch !== '' ? { baseBranch } : {}),
    ...(payload.state === undefined ? {} : { state: payload.state }),
    ...(reviewState === undefined ? {} : { reviewState }),
    ...(payload.path === undefined ? {} : { path: payload.path }),
    ...(payload.line === undefined ? {} : { line: payload.line }),
    ...(payload.startLine === undefined ? {} : { startLine: payload.startLine }),
    ...(payload.side === undefined ? {} : { side: payload.side }),
    ...(payload.diffHunk === undefined ? {} : { diffHunk: payload.diffHunk }),
    ...(payload.inReplyTo === undefined ? {} : { inReplyTo: payload.inReplyTo }),
    ...(checks === undefined ? {} : { checks }),
    ...(stillQueued ? { mergeQueued: true } : {}),
  }
}

const subscribedSessions = async (args: {
  tx: Tx
  event: Row<'GithubPrEvent'>
  now: Date
}): Promise<Array<{ threadId: string; sessionId: string }>> => {
  const { tx, event } = args
  const held = await tx.orm.public.GithubSubscription.where({
    userId: event.userId,
    prNumber: event.prNumber,
  })
    .where((subscription) => subscription.repoFullName.ilike(repoPattern(event.repoFullName)))
    .where((subscription) => subscription.threadId.neq(''))
    .where(subscriptionLiveWhere({ now: args.now }))
    .all()
  const subscriptions = held.filter((subscription) =>
    wantsPrEvent({ events: subscription.events, kind: event.kind }),
  )
  if (subscriptions.length === 0) return []
  const threadIds = [...new Set(subscriptions.map((subscription) => subscription.threadId))]
  const threads = await tx.orm.public.Thread.where((thread) => thread.id.in(threadIds)).all()
  return threads.map((thread) => ({
    threadId: thread.id,
    sessionId: thread.sessionId,
  }))
}

const TERMINAL_PR_STATES: readonly string[] = [EPullRequestState.Merged, EPullRequestState.Closed]

const endsPullRequest = (event: Row<'GithubPrEvent'>): boolean =>
  event.kind === EApiPrEventKind.State &&
  TERMINAL_PR_STATES.includes((event.payload as GithubPrEventPayload).state ?? '')

const openRowsOf = async (args: {
  tx: Tx
  event: Row<'GithubPrEvent'>
}): Promise<Row<'GithubSubscription'>[]> =>
  args.tx.orm.public.GithubSubscription.where({
    userId: args.event.userId,
    prNumber: args.event.prNumber,
  })
    .where((subscription) => subscription.repoFullName.ilike(repoPattern(args.event.repoFullName)))
    .where((subscription) => subscription.threadId.neq(''))
    .all()

const endPullRequestSubscriptions = async (args: {
  tx: Tx
  event: Row<'GithubPrEvent'>
  at: Date
}): Promise<number> => {
  const rows = await openRowsOf(args)
  return endSubscriptionsIn({
    tx: controlTxOf(args.tx),
    rows: rows.map((row) => ({ subscriptionId: row.id, threadId: row.threadId })),
    by: ESubscriptionActor.Provider,
    reason: ESubscriptionEnd.Completed,
    at: args.at.toISOString(),
  })
}

const postEventNotices = async (args: {
  tx: Tx
  event: Row<'GithubPrEvent'>
  at: Date
}): Promise<number> => {
  const { tx, event } = args
  const id = event.id
  const firedAt = args.at
  const targets = await subscribedSessions({ tx, event, now: firedAt })
  if (targets.length === 0) return 0
  const state = await tx.orm.public.GithubPrState.where({
    repoFullName: event.repoFullName,
    prNumber: event.prNumber,
  }).first()
  const payload = inboxEventPayloadOf({ event: prEventBodyOf({ event, tally: state }) })
  let posted = 0
  for (const target of targets) {
    const claimed = await tx.orm.public.GithubPrEventDelivery.createAndCount(
      [
        {
          eventId: id,
          threadId: target.threadId,
          ackedAt: firedAt,
          leaseExpiresAt: null,
        },
      ],
      { onConflict: 'skip' },
    )
    if (claimed === 0) continue
    await postInboxEntryIn({
      tx,
      sessionId: target.sessionId,
      kind: INBOX_KIND_EVENT,
      payload,
      at: firedAt.toISOString(),
    })
    posted += 1
  }
  return posted
}

export async function noticeSessions(args: {
  tx: Tx
  event: Row<'GithubPrEvent'>
}): Promise<number> {
  const at = new Date()
  const posted = await postEventNotices({ tx: args.tx, event: args.event, at })
  if (endsPullRequest(args.event)) await endPullRequestSubscriptions({ ...args, at })
  return posted
}
