import { describe, expect, it } from 'bun:test'

import type { EventDraft } from '../../events/body'
import type { Event } from '../../events/envelope'
import { toEventId, toRunId, toThreadId } from '../../events/ids'
import { stampDrafts } from '../../events/stamp'
import { eventBodySchema } from '../../events/schema'
import {
  ESubscriptionActor,
  ESubscriptionEnd,
  ESubscriptionStatus,
  sameTarget,
  subscriptionsOf,
} from '../subscription'

const created = (over: {
  id: string
  at?: string
  thread?: string
}): [EventDraft, string, string] => [
  {
    type: 'subscription-created',
    subscriptionId: over.id,
    provider: 'github.pull-request',
    target: { repo: 'github.com/o/r', number: 1 },
    label: `PR ${over.id}`,
    createdBy: ESubscriptionActor.Agent,
    expiresAt: '2026-10-29T00:00:00.000Z',
  },
  over.thread ?? 'thread-a',
  over.at ?? '2026-10-28T10:00:00.000Z',
]

const stamp = (entries: readonly [EventDraft, string, string][]): Event[] =>
  stampDrafts({
    drafts: entries.map(([draft]) => draft),
    envelopes: entries.map(([, thread, at], index) => ({
      id: toEventId(`event-${index + 1}`),
      seq: index + 1,
      threadId: toThreadId(thread),
      runId: toRunId('run-1'),
      depth: 0,
      at,
    })),
  })

const changed = (id: string, status: ESubscriptionStatus): [EventDraft, string, string] => [
  { type: 'subscription-changed', subscriptionId: id, status, by: ESubscriptionActor.Operator },
  'thread-a',
  '2026-10-28T11:00:00.000Z',
]

const ended = (id: string): [EventDraft, string, string] => [
  {
    type: 'subscription-ended',
    subscriptionId: id,
    reason: ESubscriptionEnd.Completed,
    by: ESubscriptionActor.Provider,
  },
  'thread-a',
  '2026-10-28T12:00:00.000Z',
]

describe('subscriptionsOf', () => {
  it('takes owner and creation time from the envelope and starts active', () => {
    const [subscription] = subscriptionsOf(
      stamp([created({ id: 's1', thread: 'thread-owner', at: '2026-10-28T09:00:00.000Z' })]),
    )

    expect(subscription).toEqual({
      id: 's1',
      provider: 'github.pull-request',
      target: { repo: 'github.com/o/r', number: 1 },
      label: 'PR s1',
      threadId: toThreadId('thread-owner'),
      createdBy: ESubscriptionActor.Agent,
      status: ESubscriptionStatus.Active,
      expiresAt: '2026-10-29T00:00:00.000Z',
      createdAt: '2026-10-28T09:00:00.000Z',
    })
  })

  it('pauses and resumes', () => {
    const paused = subscriptionsOf(
      stamp([created({ id: 's1' }), changed('s1', ESubscriptionStatus.Paused)]),
    )
    expect(paused[0]?.status).toBe(ESubscriptionStatus.Paused)

    const resumed = subscriptionsOf(
      stamp([
        created({ id: 's1' }),
        changed('s1', ESubscriptionStatus.Paused),
        changed('s1', ESubscriptionStatus.Active),
      ]),
    )
    expect(resumed[0]?.status).toBe(ESubscriptionStatus.Active)
  })

  it('drops an ended subscription and keeps the rest in creation order', () => {
    const live = subscriptionsOf(
      stamp([created({ id: 's1' }), created({ id: 's2' }), created({ id: 's3' }), ended('s2')]),
    )

    expect(live.map((subscription) => subscription.id)).toEqual(['s1', 's3'])
  })

  it('ignores changes and endings for ids it never saw', () => {
    const live = subscriptionsOf(
      stamp([changed('ghost', ESubscriptionStatus.Paused), ended('ghost'), created({ id: 's1' })]),
    )

    expect(live.map((subscription) => subscription.id)).toEqual(['s1'])
  })
})

describe('sameTarget', () => {
  it('compares by canonical JSON', () => {
    expect(sameTarget({ a: 1, b: [2] }, { a: 1, b: [2] })).toBe(true)
    expect(sameTarget({ a: 1 }, { a: 2 })).toBe(false)
    expect(sameTarget('x', null)).toBe(false)
  })
})

describe('subscription event schema', () => {
  it('round-trips every arm', () => {
    for (const [draft] of [
      created({ id: 's1' }),
      changed('s1', ESubscriptionStatus.Paused),
      ended('s1'),
    ]) {
      expect(eventBodySchema.parse(draft)).toEqual(draft)
    }
  })

  it('refuses an unknown actor', () => {
    const [draft] = changed('s1', ESubscriptionStatus.Paused)

    expect(eventBodySchema.safeParse({ ...draft, by: 'stranger' }).success).toBe(false)
  })
})
