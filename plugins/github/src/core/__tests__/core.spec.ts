import { describe, expect, it } from 'bun:test'

import {
  chainEvents,
  ESubscriptionActor,
  ESubscriptionEnd,
  ESubscriptionStatus,
  toRunId,
  toThreadId,
  type V2Body,
} from '@dltech/atlas-core'

import {
  ciWatchIntent,
  ECiWatch,
  foldSubscriptions,
  parseTargetInput,
  subscriptionsOfEvents,
  subscriptionsViewSchema,
  targetOfRepo,
} from '..'

const eventsOf = (bodies: V2Body[]) =>
  chainEvents({
    threadId: toThreadId('t1'),
    runId: toRunId('r1'),
    epoch: 1,
    at: '2026-11-08T10:00:00.000Z',
    bodies,
  })

const created = (id: string): V2Body => ({
  type: 'subscription-created',
  subscriptionId: id,
  provider: 'github.pull-request',
  target: { repo: 'github.com/o/r', number: 4 },
  label: 'o/r#4',
  createdBy: ESubscriptionActor.Agent,
})

describe('subscriptions view', () => {
  it('holds a created subscription and drops an ended one', () => {
    const live = subscriptionsOfEvents(eventsOf([created('a'), created('b')]))
    expect(live.map((row) => row.id)).toEqual(['a', 'b'])
    const ended = subscriptionsOfEvents(
      eventsOf([
        created('a'),
        created('b'),
        {
          type: 'subscription-ended',
          subscriptionId: 'a',
          reason: ESubscriptionEnd.Unsubscribed,
          by: ESubscriptionActor.Agent,
        },
      ]),
    )
    expect(ended.map((row) => row.id)).toEqual(['b'])
  })

  it('applies a status change and ignores one for an unknown id', () => {
    const state = subscriptionsOfEvents(
      eventsOf([
        created('a'),
        {
          type: 'subscription-changed',
          subscriptionId: 'a',
          status: ESubscriptionStatus.Paused,
          by: ESubscriptionActor.Operator,
        },
        {
          type: 'subscription-changed',
          subscriptionId: 'zzz',
          status: ESubscriptionStatus.Paused,
          by: ESubscriptionActor.Operator,
        },
      ]),
    )
    expect(state).toHaveLength(1)
    expect(state[0]?.status).toBe(ESubscriptionStatus.Paused)
  })

  it('leaves state untouched for unrelated events and round-trips its schema', () => {
    const [other] = eventsOf([{ type: 'user-said', text: 'hi' }])
    const state = subscriptionsOfEvents(eventsOf([created('a')]))
    expect(other && foldSubscriptions(state, other)).toBe(state)
    expect(subscriptionsViewSchema.parse(JSON.parse(JSON.stringify(state)))).toEqual(state)
  })
})

describe('target parsing', () => {
  it.each<[string, ReturnType<typeof parseTargetInput>['kind']]>([
    ['', 'current'],
    ['#12', 'number'],
    ['12', 'number'],
    ['o/r#3', 'explicit'],
    ['https://github.com/O/R/pull/3/files', 'explicit'],
    ['nonsense', 'error'],
    ['#0', 'error'],
  ])('reads %p as %s', (input, kind) => {
    expect(parseTargetInput(input).kind).toBe(kind)
  })

  it('lowercases the repository and prefixes the host', () => {
    expect(parseTargetInput('Dltech/Atlas#9')).toEqual({
      kind: 'explicit',
      target: { repo: 'github.com/dltech/atlas', number: 9 },
    })
    expect(targetOfRepo({ nameWithOwner: 'bad', number: 1 })).toBeUndefined()
  })
})

describe('ci watch intent', () => {
  it.each([
    ['gh pr checks --watch', ECiWatch.Watching],
    ['gh run watch 123', ECiWatch.Watching],
    ['watch gh pr checks', ECiWatch.Watching],
    ['gh pr checks', ECiWatch.Reading],
    ['echo "gh run watch"', ECiWatch.Reading],
  ])('%p is %s', (command, expected) => {
    expect(ciWatchIntent({ command })).toBe(expected)
  })
})
