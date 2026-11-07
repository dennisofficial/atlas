import { describe, expect, it } from 'bun:test'
import { ESessionStatus } from '@dltech/atlas-core'
import {
  EStreamResetReason,
  type SessionStatusOutput,
  type StreamServerMessage,
} from '@dltech/atlas-protocol'

import { memorySessionCache } from '../session-cache'
import { createSessionFollower } from '../session-follower'
import { createFakeScheduler, eventsMessage, mintUserEvents } from './support'

const statusOf = (state: ESessionStatus): SessionStatusOutput => ({
  state,
  lease: { epoch: 1, holderHostId: 7, live: true },
})

const viewBase = {
  context: null,
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
}

const sessionView = (params: { at: number; state?: ESessionStatus }): StreamServerMessage => ({
  type: 'view',
  id: 's1',
  name: 'session',
  at: params.at,
  value: { ...viewBase, at: params.at, status: statusOf(params.state ?? ESessionStatus.Idle) },
})

const statusView = (params: { at: number; state?: ESessionStatus }): StreamServerMessage => ({
  type: 'view',
  id: 's1',
  name: 'status',
  at: params.at,
  value: statusOf(params.state ?? ESessionStatus.Idle),
})

const setup = () =>
  createSessionFollower({
    sessionId: 'session-1',
    cache: memorySessionCache(),
    scheduler: createFakeScheduler().scheduler,
    onResnap: () => undefined,
  })

describe('the session follower view', () => {
  it('keeps the whole view and its status from a session view frame', () => {
    const follower = setup()
    follower.handleMessage(sessionView({ at: 0, state: ESessionStatus.Thinking }))
    const snapshot = follower.getSnapshot()
    expect(snapshot.status?.state).toBe(ESessionStatus.Thinking)
    expect(snapshot.view?.status).toEqual(snapshot.status)
    expect(snapshot.view?.spend.rows).toEqual([])
  })

  it('discards a session view whose position is behind the cursor', () => {
    const follower = setup()
    follower.handleMessage(
      eventsMessage({ id: 's1', events: mintUserEvents({ count: 20 }), live: true }),
    )
    follower.handleMessage(sessionView({ at: 5, state: ESessionStatus.Thinking }))
    expect(follower.getSnapshot().view).toBeUndefined()
    expect(follower.getSnapshot().status).toBeUndefined()
    follower.handleMessage(sessionView({ at: 20, state: ESessionStatus.Thinking }))
    expect(follower.getSnapshot().view?.at).toBe(20)
  })

  it('serves a version 1 server: a status frame sets status and leaves the view empty', () => {
    const follower = setup()
    follower.handleMessage(statusView({ at: 0, state: ESessionStatus.Thinking }))
    expect(follower.getSnapshot().status?.state).toBe(ESessionStatus.Thinking)
    expect(follower.getSnapshot().view).toBeUndefined()
  })

  it('clears the view on a reset', () => {
    const follower = setup()
    follower.handleMessage(sessionView({ at: 0 }))
    follower.handleMessage({
      type: 'reset',
      id: 's1',
      reason: EStreamResetReason.Fork,
      tailFrom: 0,
    })
    expect(follower.getSnapshot().view).toBeUndefined()
  })
})
