import { db, type Tx } from '@dltech/atlas-db'

import { appendStoredWithin, nextRunId } from '../../platform/sessions/append'
import type { ThreadSignalPublisher } from '../../platform/sessions/thread-signals.service'
import { threadSubscriptions } from '../../platform/sessions/thread-subscriptions'
import type { EPrEventKind, GithubPrEventPayload } from './github-realtime.types'

export type WakePrEvent = {
  userId: string
  repoFullName: string
  prNumber: number
  kind: EPrEventKind
  payload: GithubPrEventPayload
  eventId?: string
}

export type WakeEventNotice = Pick<WakePrEvent, 'userId' | 'repoFullName' | 'prNumber'>

const GITHUB_PREFIX = 'github.com/'

/**
 * Stable per (thread, mailbox event): a duplicate webhook delivery never double-appends, and two
 * distinct events on the same SHA no longer collide. Events without a mailbox id (legacy)
 * fall back to the composite key.
 */
export function wakeEventKeyOf(args: { threadId: string; event: WakePrEvent }): string {
  const { event } = args
  if (event.eventId !== undefined) return `pr-wake:${args.threadId}:${event.eventId}`
  return [
    'pr-wake',
    args.threadId,
    event.repoFullName,
    event.prNumber,
    event.kind,
    event.payload.url,
    event.payload.headSha ?? '',
  ].join(':')
}

/**
 * The durable half of a wake: the event becomes a `pr-event` row on the thread before the boot,
 * so a clientless pod pulls it on hydrate and runs the turn (it is turn-taking, so awaitsReply
 * holds). The appended row carries the conversation subscription's id, so a connected harness
 * provider dedupes it against the same event arriving over the live SSE stream.
 */
export async function appendWakeIntent(args: {
  threadId: string
  event: WakePrEvent
  signals: ThreadSignalPublisher
}): Promise<void> {
  const subscriptionId = await prSubscriptionIdOf({
    threadId: args.threadId,
    repoFullName: args.event.repoFullName,
    prNumber: args.event.prNumber,
  })
  const key = wakeEventKeyOf({ threadId: args.threadId, event: args.event })
  const { appended } = await db.transaction(async (tx) => {
    if (await wakeIntentExists({ tx, threadId: args.threadId, key })) {
      return { appended: undefined }
    }
    const { prNumber, kind, payload } = args.event
    return appendStoredWithin({
      tx,
      threadId: args.threadId,
      userId: args.event.userId,
      runId: nextRunId(),
      drafts: [
        {
          type: 'pr-event',
          body: JSON.stringify({
            type: 'pr-event',
            repo: `${GITHUB_PREFIX}${args.event.repoFullName}`,
            prNumber,
            kind,
            url: payload.url,
            wakeKey: key,
            ...(args.event.eventId === undefined ? {} : { eventId: args.event.eventId }),
            ...(subscriptionId === undefined ? {} : { subscriptionId }),
            ...(payload.authorLogin === undefined ? {} : { authorLogin: payload.authorLogin }),
            ...(payload.body === undefined ? {} : { body: payload.body }),
            ...(payload.verdict === undefined ? {} : { verdict: payload.verdict }),
            ...(payload.headSha === undefined ? {} : { headSha: payload.headSha }),
            ...(payload.settled === undefined ? {} : { settled: payload.settled }),
            ...(payload.mergeable === undefined ? {} : { mergeable: payload.mergeable }),
            ...(payload.state === undefined ? {} : { state: payload.state }),
            ...(payload.reviewState === undefined ? {} : { reviewState: payload.reviewState }),
          }),
        },
      ],
    })
  })
  if (appended !== undefined) {
    await args.signals.eventsAppended({ threadId: args.threadId, ...appended })
  }
}

async function wakeIntentExists(args: { tx: Tx; threadId: string; key: string }): Promise<boolean> {
  const rows = await args.tx.orm.public.Event.where({
    threadId: args.threadId,
    type: 'pr-event',
  })
    .select('body')
    .all()
  const marker = `"wakeKey":${JSON.stringify(args.key)}`
  return rows.some((row) => row.body.includes(marker))
}

async function prSubscriptionIdOf(args: {
  threadId: string
  repoFullName: string
  prNumber: number
}): Promise<string | undefined> {
  const subscriptions = await threadSubscriptions({ reader: db, threadId: args.threadId }).catch(
    () => [],
  )
  const wantedRepo = `${GITHUB_PREFIX}${args.repoFullName}`.toLowerCase()
  const match = subscriptions.find((subscription) => {
    if (subscription.provider !== 'github.pull-request') return false
    const target = subscription.target
    if (typeof target !== 'object' || target === null || Array.isArray(target)) return false
    const repo = (target as Record<string, unknown>).repo
    return (
      typeof repo === 'string' &&
      repo.toLowerCase() === wantedRepo &&
      (target as Record<string, unknown>).number === args.prNumber
    )
  })
  return match?.id
}
