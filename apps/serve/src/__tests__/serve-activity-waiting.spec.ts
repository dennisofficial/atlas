import { describe, expect, it } from 'bun:test'

import { toRunId, toThreadId, type WaitingForModel } from '@dltech/atlas-core'
import { createDeltaChannel, ETurnStatus } from '@dltech/atlas-harness'
import { API_PROVISIONED_ENV } from '@dltech/atlas-wire'

import { bindServeActivity } from '../serve-activity-binding'
import type { ActivityState } from '../serve-activity-reporter'
import { waitingAwareReport } from '../serve-activity-waiting'

const waiting = {
  episode: { kind: 'control-plane', code: 'down', providerId: 'anthropic', modelId: null },
  cause: 'control-plane',
  providerId: 'anthropic',
  accountId: null,
  modelId: null,
  reason: null,
  resetAt: null,
  affectedThreadIds: [],
} as WaitingForModel

const collect = () => {
  const states: ActivityState[] = []
  return { states, report: waitingAwareReport({ report: (state) => states.push(state) }) }
}

describe('waitingAwareReport', () => {
  it('posts nothing about waiting until a wait exists', () => {
    const { states, report } = collect()
    report({ working: false, awaiting: null })
    expect(states).toEqual([{ working: false, awaiting: null }])
    expect(Object.hasOwn(states[0] ?? {}, 'waitingForModel')).toBe(false)
  })

  it('serializes the snapshot while waiting and posts an explicit null once on clear', () => {
    const { states, report } = collect()
    report({ working: false, awaiting: null, waitingForModel: waiting })
    report({ working: false, awaiting: null })
    report({ working: false, awaiting: null })
    expect(states).toEqual([
      { working: false, awaiting: null, waitingForModel: JSON.stringify(waiting) },
      { working: false, awaiting: null, waitingForModel: null },
      { working: false, awaiting: null },
    ])
  })
})

describe('bindServeActivity waiting persistence', () => {
  it('keeps the posted wait across a generic turn start and end, clearing only on setWaiting(null)', () => {
    const states: ActivityState[] = []
    const activity = bindServeActivity({
      env: { [API_PROVISIONED_ENV]: '1' },
      threadId: toThreadId('thr-1'),
      remote: { controlPlaneUrl: 'http://api', token: 't', clientVersion: '0', fetchFn: fetch },
      log: () => undefined,
      app: {
        log: { readOwn: async () => [], head: async () => 0 } as never,
        channel: createDeltaChannel(),
        roster: undefined as never,
      },
      reporter: { report: (state) => states.push(state), whenIdle: async () => undefined },
    })
    activity.tracker.setWaiting(waiting)
    activity.tracker.turnStarted()
    activity.tracker.turnOutcome({ status: ETurnStatus.Completed, runId: toRunId('run') })
    activity.tracker.turnEnded()
    expect(states.map((state) => state.waitingForModel)).toEqual([
      JSON.stringify(waiting),
      JSON.stringify(waiting),
      JSON.stringify(waiting),
    ])
    activity.tracker.setWaiting(null)
    expect(states.at(-1)).toMatchObject({ waitingForModel: null })
    activity.detach()
  })

  it('parking posts without the field so the persisted wait survives', async () => {
    const states: ActivityState[] = []
    const activity = bindServeActivity({
      env: { [API_PROVISIONED_ENV]: '1' },
      threadId: toThreadId('thr-1'),
      remote: { controlPlaneUrl: 'http://api', token: 't', clientVersion: '0', fetchFn: fetch },
      log: () => undefined,
      app: {
        log: { readOwn: async () => [], head: async () => 0 } as never,
        channel: createDeltaChannel(),
        roster: undefined as never,
      },
      reporter: { report: (state) => states.push(state), whenIdle: async () => undefined },
    })
    activity.tracker.setWaiting(waiting)
    await activity.reportParked()
    expect(states.at(-1)).toEqual({ working: false, awaiting: null })
    activity.detach()
  })
})
