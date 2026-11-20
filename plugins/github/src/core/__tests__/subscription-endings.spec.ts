import { describe, expect, it } from 'bun:test'

import {
  chainEvents,
  EPrEventKind,
  ESubscriptionActor,
  ESubscriptionEnd,
  toRunId,
  toThreadId,
  type JsonValue,
  type V2Body,
} from '@dltech/atlas-core'

import { subscriptionEndingsOf } from '..'

const NOW = new Date('2026-11-20T00:00:00.000Z')

const eventsOf = (bodies: V2Body[]) =>
  chainEvents({
    threadId: toThreadId('t1'),
    runId: toRunId('r1'),
    epoch: 1,
    at: '2026-11-08T10:00:00.000Z',
    bodies,
  })

const ended = (args: { events: V2Body[]; now?: Date }) =>
  subscriptionEndingsOf({
    events: eventsOf(args.events),
    now: args.now ?? NOW,
  })

const created = (args: {
  id?: string
  repo?: string
  provider?: string
  target?: JsonValue
  expiresAt?: string
}): V2Body => ({
  type: 'subscription-created',
  subscriptionId: args.id ?? 'a',
  provider: args.provider ?? 'github.pull-request',
  target: args.target ?? { repo: args.repo ?? 'github.com/o/r', number: 4 },
  label: 'o/r#4',
  createdBy: ESubscriptionActor.Agent,
  ...(args.expiresAt === undefined ? {} : { expiresAt: args.expiresAt }),
})

const prEvent = (args: {
  kind?: EPrEventKind
  state?: string
  repo?: string
  number?: number
}): V2Body => ({
  type: 'pr-event',
  repo: args.repo ?? 'github.com/o/r',
  prNumber: args.number ?? 4,
  kind: args.kind ?? EPrEventKind.State,
  url: 'https://github.com/o/r/pull/4',
  ...(args.state === undefined ? {} : { state: args.state }),
})

const runCreated = (args: { target: JsonValue }): V2Body =>
  created({ provider: 'github.workflow-run', target: args.target })

const runEvent = (args: { repo?: string; runId?: number }): V2Body => ({
  type: 'run-event',
  repo: args.repo ?? 'o/r',
  workflowRunId: args.runId ?? 7,
  workflow: 'ci.yml',
  branch: 'main',
  url: 'https://github.com/o/r/actions/runs/7',
  status: 'completed',
  conclusion: 'success',
})

describe('subscription endings', () => {
  it('completes a pull request subscription when its pull request merges', () => {
    expect(ended({ events: [created({}), prEvent({ state: 'merged' })] })).toEqual([
      { subscriptionId: 'a', reason: ESubscriptionEnd.Completed, by: ESubscriptionActor.Provider },
    ])
  })

  it('completes a pull request subscription when its pull request closes', () => {
    expect(ended({ events: [created({}), prEvent({ state: 'closed' })] })).toHaveLength(1)
  })

  it.each([
    ['a reopen', prEvent({ state: 'open' })],
    ['a state event with no state', prEvent({})],
    ['a comment', prEvent({ kind: EPrEventKind.Comment, state: 'merged' })],
  ])('leaves the subscription live on %s', (_what, event) => {
    expect(ended({ events: [created({}), event] })).toEqual([])
  })

  it.each([[{ number: 5 }], [{ repo: 'github.com/o/other' }]])(
    'ignores a terminal event for another pull request: %p',
    (other) => {
      expect(ended({ events: [created({}), prEvent({ state: 'merged', ...other })] })).toEqual([])
    },
  )

  it('matches the repository without regard to case', () => {
    expect(
      ended({ events: [created({}), prEvent({ state: 'merged', repo: 'GitHub.com/O/R' })] }),
    ).toHaveLength(1)
  })

  it('ignores a terminal event that arrives before the subscription is created', () => {
    expect(ended({ events: [prEvent({ state: 'merged' }), created({})] })).toEqual([])
  })

  it('completes a pinned workflow run subscription when that run finishes', () => {
    const target = { kind: 'run', repo: 'github.com/o/r', runId: 7 }
    expect(ended({ events: [runCreated({ target }), runEvent({})] })).toEqual([
      { subscriptionId: 'a', reason: ESubscriptionEnd.Completed, by: ESubscriptionActor.Provider },
    ])
  })

  it('keeps a selector subscription through a matching run', () => {
    const target = { kind: 'selector', repo: 'github.com/o/r', workflow: 'ci.yml', branch: 'main' }
    expect(ended({ events: [runCreated({ target }), runEvent({})] })).toEqual([])
  })

  it('reports an already ended subscription once at most', () => {
    expect(
      ended({
        events: [
          created({}),
          prEvent({ state: 'merged' }),
          {
            type: 'subscription-ended',
            subscriptionId: 'a',
            reason: ESubscriptionEnd.Completed,
            by: ESubscriptionActor.Provider,
          },
        ],
      }),
    ).toEqual([])
  })

  it.each([
    ['2026-11-19T00:00:00.000Z', ESubscriptionEnd.Expired],
    ['2026-11-21T00:00:00.000Z', null],
  ])('treats an expiresAt of %p as %p', (expiresAt, reason) => {
    expect(ended({ events: [created({ expiresAt })] })).toEqual(
      reason === null ? [] : [{ subscriptionId: 'a', reason, by: ESubscriptionActor.Clock }],
    )
  })

  it('never expires a subscription that declares no expiry', () => {
    expect(ended({ events: [created({})], now: new Date('2030-01-01T00:00:00.000Z') })).toEqual([])
  })

  it('prefers the completed reason over the expired one', () => {
    expect(
      ended({
        events: [created({ expiresAt: '2026-11-19T00:00:00.000Z' }), prEvent({ state: 'merged' })],
      }),
    ).toEqual([
      { subscriptionId: 'a', reason: ESubscriptionEnd.Completed, by: ESubscriptionActor.Provider },
    ])
  })
})
