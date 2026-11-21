import { describe, expect, it } from 'bun:test'

import {
  chainEvents,
  EStage,
  ESubscriptionActor,
  ESubscriptionEnd,
  toRunId,
  toThreadId,
  type JsonValue,
  type SubscriptionEndRules,
  type V2Body,
  type V2Event,
} from '@dltech/atlas-core'

import { subscriptionEndHooksOf } from '../subscription-end-hooks'

const NOW = new Date('2026-11-20T00:00:00.000Z')

const PROVIDER = 'test.thing'

const thingKeyOf = (target: JsonValue): number | undefined => {
  if (typeof target !== 'object' || target === null || Array.isArray(target)) return undefined
  const key = target.key
  return typeof key === 'number' ? key : undefined
}

const rules: SubscriptionEndRules = {
  [PROVIDER]: ({ target, event }) =>
    event.type === 'run-event' && thingKeyOf(target) === event.workflowRunId,
}

const eventsOf = (bodies: V2Body[]): V2Event[] =>
  chainEvents({
    threadId: toThreadId('t1'),
    runId: toRunId('r1'),
    epoch: 1,
    at: '2026-11-08T10:00:00.000Z',
    bodies,
  })

const created: V2Body = {
  type: 'subscription-created',
  subscriptionId: 'a',
  provider: PROVIDER,
  target: { key: 7 },
  label: 'thing 7',
  createdBy: ESubscriptionActor.Agent,
}

const runEvent: V2Body = {
  type: 'run-event',
  repo: 'o/r',
  workflowRunId: 7,
  workflow: 'ci.yml',
  branch: 'main',
  url: 'https://github.com/o/r/actions/runs/7',
  status: 'completed',
  conclusion: 'success',
}

const hooksOf = (bodies: V2Body[]) =>
  subscriptionEndHooksOf({
    rules,
    events: () => eventsOf(bodies),
    now: () => NOW,
  })

const runArgs = { threadId: toThreadId('t1'), projectDirectory: '/work/repo' }

describe('subscriptionEndHooksOf', () => {
  it('drafts the ending before the next turn', async () => {
    const [hook] = hooksOf([created, runEvent]).beforeTurn ?? []
    const outcome = await hook?.run(runArgs)

    expect(hook?.order).toEqual({ stage: EStage.Observe, nudge: 0 })
    expect(outcome?.drafts).toEqual([
      {
        type: 'subscription-ended',
        subscriptionId: 'a',
        reason: ESubscriptionEnd.Completed,
        by: ESubscriptionActor.Provider,
      },
    ])
  })

  it('drafts the ending after the turn too', async () => {
    const [hook] = hooksOf([created, runEvent]).afterTurn ?? []
    const outcome = await hook?.run(runArgs)

    expect(hook?.order).toEqual({ stage: EStage.Observe, nudge: 0 })
    expect(outcome?.drafts).toHaveLength(1)
  })

  it('drafts nothing when no subscription has ended', async () => {
    const [before] = hooksOf([created]).beforeTurn ?? []
    const [after] = hooksOf([created]).afterTurn ?? []

    expect(await before?.run(runArgs)).toEqual({})
    expect(await after?.run(runArgs)).toEqual({})
  })
})
