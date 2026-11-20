import { describe, expect, it } from 'bun:test'
import {
  ERetryReason,
  ESessionStatus,
  toCallId,
  type LogHead,
  type V2Body,
  type V2Event,
} from '@dltech/atlas-core'

import { memorySessionLog } from '../session-log'
import { createSessionFollower, type SessionFollower } from '../session-follower'
import { createFakeScheduler, eventsMessage, headOf, mintEvents, settle } from './support'

const SESSION = 'session-1'
const FUTURE = new Date(60_000).toISOString()

const userSaid: V2Body = { type: 'user-said', text: 'hi' }
const finalReply: V2Body = { type: 'assistant-said', parts: [{ type: 'text', text: 'done' }] }
const toolCall: V2Body = {
  type: 'tool-called',
  callId: toCallId('c1'),
  name: 'bash',
  ordinal: 0,
}
const toolRunning: V2Body = {
  type: 'tool-dispatched',
  callId: toCallId('c1'),
  name: 'bash',
}
const parked: V2Body = { type: 'tool-parked', callId: toCallId('c1'), name: 'bash' }
const retry: V2Body = {
  type: 'retry-scheduled',
  key: 'k',
  notBefore: FUTURE,
  attempt: 1,
  reason: ERetryReason.RateLimited,
}
const startFailed: V2Body = {
  type: 'session-start-failed',
  reason: 'no credentials',
  inboxHead: 3,
  permanent: false,
}
const posted: V2Body = {
  type: 'input-posted',
  inboxId: 4,
  kind: 'message',
  postedAt: new Date(1_000).toISOString(),
  text: 'again',
}

const setup = (log = memorySessionLog()) => {
  const { scheduler, advance } = createFakeScheduler()
  const follower = createSessionFollower({
    sessionId: SESSION,
    log,
    scheduler,
    onResnap: () => undefined,
  })
  return { follower, log, advance }
}

const say = (args: {
  follower: SessionFollower
  bodies: readonly V2Body[]
  from?: LogHead | undefined
}): readonly V2Event[] => {
  const events = mintEvents({ bodies: args.bodies, from: args.from })
  args.follower.handleMessage(eventsMessage({ id: 's1', events, live: true }))
  return events
}

describe('the client status fold', () => {
  it('shows idle in the same snapshot that carries the final assistant-said', () => {
    const { follower } = setup()
    say({ follower, bodies: [userSaid, finalReply] })
    const snapshot = follower.getSnapshot()
    expect(snapshot.status?.state).toBe(ESessionStatus.Idle)
    expect(snapshot.events.map((event) => event.type)).toEqual(['user-said', 'assistant-said'])
    expect(snapshot.view?.at).toBe(2)
    expect(snapshot.view?.status).toEqual(snapshot.status)
  })

  it('shows thinking while a tool call is being prepared', () => {
    const { follower } = setup()
    say({ follower, bodies: [userSaid, toolCall] })
    expect(follower.getSnapshot().status?.state).toBe(ESessionStatus.Thinking)
  })

  it('shows running-tool from a dispatched call', () => {
    const { follower } = setup()
    say({ follower, bodies: [userSaid, toolRunning] })
    expect(follower.getSnapshot().status).toEqual({
      state: ESessionStatus.RunningTool,
      reason: 'bash',
      since: follower.getSnapshot().status?.since,
      lease: { epoch: 0, holderHostId: null, live: false },
    })
  })

  it('shows waiting-for-operator from a parked call', () => {
    const { follower } = setup()
    say({ follower, bodies: [userSaid, parked] })
    const status = follower.getSnapshot().status
    expect(status?.state).toBe(ESessionStatus.WaitingForOperator)
    expect(status?.reason).toBe('bash')
  })

  it('flips waiting-to-retry when the earliest retry deadline passes, without a frame', () => {
    const { follower, advance } = setup()
    follower.handleMessage({
      type: 'view',
      id: 's1',
      name: 'session',
      at: 0,
      value: {
        at: 0,
        status: { state: ESessionStatus.Idle, lease: { epoch: 1, holderHostId: 7, live: true } },
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
        pluginViews: {},
      },
    })
    say({ follower, bodies: [userSaid, retry] })
    expect(follower.getSnapshot().status?.state).toBe(ESessionStatus.WaitingToRetry)
    advance(60_000)
    expect(follower.getSnapshot().status?.state).toBe(ESessionStatus.Thinking)
  })

  it('reports setup-failed but queued once a message is posted after the failure', () => {
    const { follower } = setup()
    const first = say({ follower, bodies: [startFailed] })
    expect(follower.getSnapshot().status?.state).toBe(ESessionStatus.StartFailed)
    say({ follower, bodies: [posted], from: headOf(first) })
    expect(follower.getSnapshot().status?.state).toBe(ESessionStatus.Queued)
  })

  it('keeps folding after a restore from the log snapshot', async () => {
    const log = memorySessionLog()
    const first = setup(log)
    const events = say({ follower: first.follower, bodies: [userSaid, finalReply] })
    await settle()
    const restored = setup(log)
    await restored.follower.hydrated
    const snapshot = restored.follower.getSnapshot()
    expect(snapshot.fromCache).toBe(true)
    expect(snapshot.status?.state).toBe(ESessionStatus.Idle)
    expect(snapshot.view?.at).toBe(2)
    say({ follower: restored.follower, bodies: [toolCall], from: headOf(events) })
    expect(restored.follower.getSnapshot().status?.state).toBe(ESessionStatus.Thinking)
  })
})
