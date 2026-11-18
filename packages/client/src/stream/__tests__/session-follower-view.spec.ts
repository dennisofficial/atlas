import { describe, expect, it } from 'bun:test'
import { ESessionStatus, type LogHead, type SpendTally } from '@dltech/atlas-core'
import {
  EStreamResetReason,
  type SessionStatusOutput,
  type StreamServerMessage,
} from '@dltech/atlas-protocol'

import { memorySessionLog } from '../session-log'
import { EStreamConnectionState } from '../connection-machine'
import { createSessionFollower, ESessionConnection } from '../session-follower'
import { createFakeScheduler, eventsMessage, headOf, mintEvents, userSaid } from './support'

const tally: SpendTally = {
  inputTokens: 9,
  outputTokens: 4,
  cacheReadTokens: 1,
  cacheWriteTokens: 0,
  uncachedInputTokens: 8,
  costUsd: 0.5,
}

const statusOf = (state: ESessionStatus, live: boolean): SessionStatusOutput => ({
  state,
  lease: { epoch: 1, holderHostId: 7, live },
})

const sessionView = (params: {
  at: number
  state?: ESessionStatus
  live?: boolean
  pullRequestState?: string
}): StreamServerMessage => ({
  type: 'view',
  id: 's1',
  name: 'session',
  at: params.at,
  value: {
    at: params.at,
    status: statusOf(params.state ?? ESessionStatus.Idle, params.live ?? true),
    context: null,
    spend: { rows: [], tally },
    checkouts: { repos: [], primary: null },
    pullRequests: [
      {
        repo: 'acme/atlas',
        number: 7,
        url: 'https://github.com/acme/atlas/pull/7',
        branch: 'fix',
        state:
          params.pullRequestState === undefined
            ? null
            : {
                title: 'Fix',
                state: params.pullRequestState,
                headSha: 'abc',
                checks: { running: 0, passed: 2, failed: 0 },
                mergeable: true,
                updatedAt: '2026-11-18T10:00:00.000Z',
              },
      },
    ],
    pluginViews: {},
  },
})

const setup = () =>
  createSessionFollower({
    sessionId: 'session-1',
    log: memorySessionLog(),
    scheduler: createFakeScheduler().scheduler,
    onResnap: () => undefined,
  })

const seed = (follower: ReturnType<typeof setup>): LogHead => {
  const events = mintEvents({
    bodies: [userSaid('hi'), { type: 'assistant-said', parts: [{ type: 'text', text: 'done' }] }],
  })
  follower.handleMessage(eventsMessage({ id: 's1', events, live: true }))
  return headOf(events)
}

const linked = (follower: ReturnType<typeof setup>, from: LogHead): void => {
  follower.handleMessage(
    eventsMessage({
      id: 's1',
      events: mintEvents({
        from,
        bodies: [
          {
            type: 'pull-request-linked',
            repo: 'acme/atlas',
            number: 7,
            url: 'https://github.com/acme/atlas/pull/7',
            branch: 'fix',
          },
        ],
      }),
      live: true,
    }),
  )
}

describe('the session follower frame facts', () => {
  it('never lets a frame status override the log-derived one', () => {
    const follower = setup()
    seed(follower)
    follower.handleMessage(sessionView({ at: 2, state: ESessionStatus.Failed, live: true }))
    const snapshot = follower.getSnapshot()
    expect(snapshot.status?.state).toBe(ESessionStatus.Idle)
    expect(snapshot.view?.status).toEqual(snapshot.status)
    expect(snapshot.view?.at).toBe(2)
  })

  it('takes only lease liveness, spend tally and pull request state from a frame', () => {
    const follower = setup()
    const from = seed(follower)
    linked(follower, from)
    follower.handleMessage(sessionView({ at: 3, pullRequestState: 'open' }))
    const view = follower.getSnapshot().view
    expect(view?.spend).toEqual({ rows: [], tally })
    expect(view?.status.lease).toEqual({ epoch: 1, holderHostId: 7, live: true })
    expect(view?.pullRequests[0]?.state?.state).toBe('open')
    expect(view?.pluginViews).toEqual({})
  })

  it('discards a session view whose position is behind the cursor', () => {
    const follower = setup()
    seed(follower)
    follower.handleMessage(sessionView({ at: 1, live: false }))
    expect(follower.getSnapshot().view?.status.lease).toEqual({
      epoch: 0,
      holderHostId: null,
      live: false,
    })
    follower.handleMessage(sessionView({ at: 2 }))
    expect(follower.getSnapshot().view?.status.lease.live).toBe(true)
  })

  it('clears catching up when a session view is already at the window cursor', () => {
    const follower = setup()
    follower.setConnection(EStreamConnectionState.Open)
    const events = mintEvents({
      bodies: [userSaid('hi'), { type: 'assistant-said', parts: [{ type: 'text', text: 'done' }] }],
    })
    follower.handleMessage(eventsMessage({ id: 's1', events, live: false }))
    expect(follower.getSnapshot().connection).toBe(ESessionConnection.CatchingUp)

    follower.handleMessage(sessionView({ at: 2 }))
    expect(follower.getSnapshot().connection).toBe(ESessionConnection.Live)
  })

  it('stays catching up while a view arrives before the log has a cursor', () => {
    const follower = setup()
    follower.setConnection(EStreamConnectionState.Open)
    follower.handleMessage(sessionView({ at: 0 }))
    expect(follower.getSnapshot().connection).toBe(ESessionConnection.CatchingUp)
  })

  it('has no status before the log has a cursor', () => {
    const follower = setup()
    follower.handleMessage(sessionView({ at: 0 }))
    expect(follower.getSnapshot().status).toBeUndefined()
    expect(follower.getSnapshot().view).toBeUndefined()
  })

  it('clears the derived view on a reset', () => {
    const follower = setup()
    seed(follower)
    follower.handleMessage({
      type: 'reset',
      id: 's1',
      reason: EStreamResetReason.Fork,
      tailFrom: 0,
    })
    expect(follower.getSnapshot().view).toBeUndefined()
    expect(follower.getSnapshot().status).toBeUndefined()
  })
})
