import { describe, expect, it } from 'bun:test'

import { toRunId, toThreadId } from '../../events/ids'
import { chainEvents } from '../../record/chain-events'
import type { V2Body } from '../../record/event'
import type { JsonValue } from '../../json/value'
import { ESubscriptionActor, ESubscriptionEnd } from '../subscription'
import { subscriptionEndingsOf, type SubscriptionEndRules } from '../endings'

const NOW = new Date('2026-11-20T00:00:00.000Z')

const THING_PROVIDER = 'test.thing'
const BARE_PROVIDER = 'test.bare'

const thingKeyOf = (target: JsonValue): number | undefined => {
  if (typeof target !== 'object' || target === null || Array.isArray(target)) return undefined
  const key = target.key
  return typeof key === 'number' ? key : undefined
}

const rules: SubscriptionEndRules = {
  [THING_PROVIDER]: ({ target, event }) =>
    event.type === 'run-event' &&
    thingKeyOf(target) !== undefined &&
    thingKeyOf(target) === event.workflowRunId,
}

const eventsOf = (bodies: V2Body[]) =>
  chainEvents({
    threadId: toThreadId('t1'),
    runId: toRunId('r1'),
    epoch: 1,
    at: '2026-11-08T10:00:00.000Z',
    bodies,
  })

const ended = (args: { events: V2Body[]; now?: Date; ruleSet?: SubscriptionEndRules }) =>
  subscriptionEndingsOf({
    events: eventsOf(args.events),
    now: args.now ?? NOW,
    rules: args.ruleSet ?? rules,
  })

const created = (args: {
  id?: string
  provider?: string
  key?: number
  expiresAt?: string
}): V2Body => ({
  type: 'subscription-created',
  subscriptionId: args.id ?? 'a',
  provider: args.provider ?? THING_PROVIDER,
  target: { key: args.key ?? 7 },
  label: 'thing 7',
  createdBy: ESubscriptionActor.Agent,
  ...(args.expiresAt === undefined ? {} : { expiresAt: args.expiresAt }),
})

const runEvent = (args: { runId?: number }): V2Body => ({
  type: 'run-event',
  repo: 'o/r',
  workflowRunId: args.runId ?? 7,
  workflow: 'ci.yml',
  branch: 'main',
  url: 'https://github.com/o/r/actions/runs/7',
  status: 'completed',
  conclusion: 'success',
})

const endedBody = (id: string): V2Body => ({
  type: 'subscription-ended',
  subscriptionId: id,
  reason: ESubscriptionEnd.Completed,
  by: ESubscriptionActor.Provider,
})

describe('subscriptionEndingsOf', () => {
  it('ends a subscription whose provider rule matches an event', () => {
    expect(ended({ events: [created({}), runEvent({})] })).toEqual([
      { subscriptionId: 'a', reason: ESubscriptionEnd.Completed, by: ESubscriptionActor.Provider },
    ])
  })

  it('leaves a subscription live when the event does not match its rule', () => {
    expect(ended({ events: [created({}), runEvent({ runId: 8 })] })).toEqual([])
  })

  it('ignores a matching event that arrives before the subscription is created', () => {
    expect(ended({ events: [runEvent({}), created({})] })).toEqual([])
  })

  it('reports an already ended subscription once at most', () => {
    expect(ended({ events: [created({}), runEvent({}), endedBody('a')] })).toEqual([])
  })

  it('starts a re-created subscription clean', () => {
    expect(ended({ events: [created({}), runEvent({}), created({})] })).toEqual([])
  })

  it('expires a subscription whose declared expiry has passed', () => {
    expect(ended({ events: [created({ expiresAt: '2026-11-19T00:00:00.000Z' })] })).toEqual([
      { subscriptionId: 'a', reason: ESubscriptionEnd.Expired, by: ESubscriptionActor.Clock },
    ])
  })

  it('keeps a subscription whose declared expiry is ahead', () => {
    expect(ended({ events: [created({ expiresAt: '2026-11-21T00:00:00.000Z' })] })).toEqual([])
  })

  it('never expires a subscription that declares no expiry', () => {
    expect(ended({ events: [created({})], now: new Date('2030-01-01T00:00:00.000Z') })).toEqual([])
  })

  it('never expires a subscription whose declared expiry is unreadable', () => {
    expect(ended({ events: [created({ expiresAt: 'soon' })] })).toEqual([])
  })

  it('prefers the completed reason over the expired one', () => {
    expect(
      ended({ events: [created({ expiresAt: '2026-11-19T00:00:00.000Z' }), runEvent({})] }),
    ).toEqual([
      { subscriptionId: 'a', reason: ESubscriptionEnd.Completed, by: ESubscriptionActor.Provider },
    ])
  })

  it('never completes a provider that declares no rule', () => {
    expect(
      ended({
        events: [created({ provider: BARE_PROVIDER }), runEvent({})],
        ruleSet: {},
      }),
    ).toEqual([])
  })

  it('still expires a provider that declares no rule', () => {
    expect(
      ended({
        events: [created({ provider: BARE_PROVIDER, expiresAt: '2026-11-19T00:00:00.000Z' })],
        ruleSet: {},
      }),
    ).toEqual([
      { subscriptionId: 'a', reason: ESubscriptionEnd.Expired, by: ESubscriptionActor.Clock },
    ])
  })
})
