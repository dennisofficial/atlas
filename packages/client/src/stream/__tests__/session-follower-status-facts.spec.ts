import { describe, expect, it } from 'bun:test'
import { ESessionStatus } from '@dltech/atlas-core'
import {
  EStreamResetReason,
  ESandboxProvider,
  ESandboxStatus,
  type StreamServerMessage,
} from '@dltech/atlas-protocol'

import { memorySessionLog } from '../session-log'
import { createSessionFollower } from '../session-follower'
import { createFakeScheduler, eventsMessage, mintUserEvents } from './support'
import { replayOf, tailBaseMessageOf } from './tail-support'

const AT = '2026-11-24T21:09:04.000Z'

const sessionView = (params: { at: number }): StreamServerMessage => ({
  type: 'view',
  id: 's1',
  name: 'session',
  at: params.at,
  value: {
    at: params.at,
    status: {
      state: ESessionStatus.Idle,
      lease: { epoch: 1, holderHostId: 7, live: true },
      sandbox: { status: ESandboxStatus.Running, at: AT },
      sandboxProvider: ESandboxProvider.Agent37,
    },
    context: null,
    compute: { costUsd: null, running: false, tick: null },
    spend: {
      rows: [],
      tally: {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        uncachedInputTokens: 0,
        costUsd: null,
      },
    },
    checkouts: { repos: [], primary: null },
    pullRequests: [],
    subscriptions: [],
    pluginViews: {},
  },
})

const setup = () => {
  const clock = createFakeScheduler()
  const follower = createSessionFollower({
    sessionId: 'session-1',
    log: memorySessionLog(),
    scheduler: clock.scheduler,
    onResnap: () => undefined,
  })
  return { follower }
}

describe('the session follower status facts', () => {
  it('keeps the pod facts a reset dropped once the replay rebuilds the window', () => {
    const { follower } = setup()
    const events = mintUserEvents({ count: 3 })
    follower.handleMessage(eventsMessage({ id: 's1', events, live: true }))
    follower.handleMessage(sessionView({ at: 3 }))
    expect(follower.getSnapshot().status?.sandbox?.status).toBe(ESandboxStatus.Running)

    follower.handleMessage({
      type: 'reset',
      id: 's1',
      reason: EStreamResetReason.Fork,
      tailFrom: 1,
    })
    follower.handleMessage(eventsMessage({ id: 's1', events, live: true }))

    const status = follower.getSnapshot().status
    expect(status?.sandbox?.status).toBe(ESandboxStatus.Running)
    expect(status?.lease).toEqual({ epoch: 1, holderHostId: 7, live: true })
  })

  it('keeps the pod facts a tail base dropped', () => {
    const { follower } = setup()
    const events = mintUserEvents({ count: 30 })
    follower.handleMessage(eventsMessage({ id: 's1', events, live: true }))
    follower.handleMessage(sessionView({ at: 30 }))

    follower.handleMessage(tailBaseMessageOf({ all: events, full: replayOf(events), tailFrom: 21 }))

    const status = follower.getSnapshot().status
    expect(status?.sandbox?.status).toBe(ESandboxStatus.Running)
    expect(status?.lease).toEqual({ epoch: 1, holderHostId: 7, live: true })
  })

  it('takes the pod facts of a view read before the events the client already holds', () => {
    const { follower } = setup()
    follower.handleMessage(
      eventsMessage({ id: 's1', events: mintUserEvents({ count: 5 }), live: true }),
    )

    follower.handleMessage(sessionView({ at: 3 }))

    const status = follower.getSnapshot().status
    expect(status?.sandbox?.status).toBe(ESandboxStatus.Running)
    expect(status?.lease).toEqual({ epoch: 1, holderHostId: 7, live: true })
  })
})
