import { describe, expect, it } from 'bun:test'
import {
  ESessionStatus,
  type LogHead,
  type PluginViewFold,
  type SpendTally,
} from '@dltech/atlas-core'
import {
  ESandboxStatus,
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
  pluginViews?: Readonly<Record<string, unknown>>
  extra?: Partial<SessionStatusOutput>
}): StreamServerMessage => ({
  type: 'view',
  id: 's1',
  name: 'session',
  at: params.at,
  value: {
    at: params.at,
    status: {
      ...statusOf(params.state ?? ESessionStatus.Idle, params.live ?? true),
      ...params.extra,
    },
    context: null,
    spend: { rows: [], tally },
    compute: { costUsd: null, running: false, tick: null },
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
    subscriptions: [],
    pluginViews: params.pluginViews ?? {},
  },
})

const setup = (views?: readonly PluginViewFold[]) =>
  createSessionFollower({
    sessionId: 'session-1',
    log: memorySessionLog(),
    scheduler: createFakeScheduler().scheduler,
    onResnap: () => undefined,
    ...(views === undefined ? {} : { views }),
  })

const seed = (follower: ReturnType<typeof setup>): LogHead => {
  const events = mintEvents({
    bodies: [userSaid('hi'), { type: 'assistant-said', parts: [{ type: 'text', text: 'done' }] }],
  })
  follower.handleMessage(eventsMessage({ id: 's1', events, live: true }))
  return headOf(events)
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

  it('takes only lease liveness, spend tally and pull requests from a frame', () => {
    const follower = setup()
    seed(follower)
    follower.handleMessage(sessionView({ at: 3, pullRequestState: 'open' }))
    const view = follower.getSnapshot().view
    expect(view?.spend).toEqual({ rows: [], tally })
    expect(view?.status.lease).toEqual({ epoch: 1, holderHostId: 7, live: true })
    expect(view?.pullRequests[0]?.state?.state).toBe('open')
    expect(view?.pluginViews).toEqual({})
  })

  it('keeps the pod and sandbox the control plane reports on the frame', () => {
    const follower = setup()
    seed(follower)
    const pod: SessionStatusOutput['pod'] = {
      shape: { vcpus: 4, memoryGb: 8 },
      actualVcpus: 4,
      phase: 'steady',
      sizing: { cap: 8, offered: [{ vcpus: 4, memoryGb: 8 }], unavailable: [] },
    }
    follower.handleMessage(
      sessionView({
        at: 3,
        extra: { pod, sandbox: { status: ESandboxStatus.Running, at: '2026-11-21T10:00:00.000Z' } },
      }),
    )
    const status = follower.getSnapshot().status
    expect(status?.pod).toEqual(pod)
    expect(status?.sandbox?.status).toBe(ESandboxStatus.Running)
    expect(follower.getSnapshot().view?.status.pod).toEqual(pod)
  })

  it('takes the facts of a session view whose position is behind the cursor', () => {
    const follower = setup()
    seed(follower)
    follower.handleMessage(sessionView({ at: 1, live: false }))
    expect(follower.getSnapshot().view?.status.lease.live).toBe(false)
    expect(follower.getSnapshot().view?.status.lease.holderHostId).not.toBeNull()
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

describe('the session follower plugin views', () => {
  const planState = { tasks: [{ ordinal: 1, text: 'read', status: 'pending' }], pending: {} }

  const plan: PluginViewFold<Readonly<Record<string, unknown>>> = {
    name: 'plan',
    initial: {},
    fold: (state) => state,
    rewindable: true,
  }

  const shells: PluginViewFold<readonly string[]> = {
    name: 'shells',
    initial: [],
    fold: (state) => state,
  }

  it('adopts a rewindable view from the control plane', () => {
    const follower = setup([plan])
    seed(follower)
    follower.handleMessage(sessionView({ at: 2, pluginViews: { plan: planState } }))
    expect(follower.getSnapshot().view?.pluginViews.plan).toEqual(planState)
  })

  it('keeps folding a view the control plane does not own', () => {
    const follower = setup([shells])
    seed(follower)
    follower.handleMessage(sessionView({ at: 2, pluginViews: { shells: ['from-the-server'] } }))
    expect(follower.getSnapshot().view?.pluginViews.shells).toEqual([])
  })

  it('leaves the bag alone when the frame repeats what it already holds', () => {
    const follower = setup([plan])
    seed(follower)
    follower.handleMessage(sessionView({ at: 2, pluginViews: { plan: planState } }))
    const held = follower.getSnapshot().view?.pluginViews
    follower.handleMessage(sessionView({ at: 2, pluginViews: { plan: planState } }))
    expect(follower.getSnapshot().view?.pluginViews).toBe(held)
  })
})
