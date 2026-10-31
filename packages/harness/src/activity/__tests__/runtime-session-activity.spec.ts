import { describe, expect, it } from 'bun:test'
import {
  EDecision,
  toCallId,
  toEventId,
  toRunId,
  toThreadId,
  type Event,
  type EventDraft,
} from '@dltech/atlas-core'

import { createDeltaChannel } from '../../channel/delta-channel'
import { ETurnStatus } from '../../loop/turn-outcome'
import { EAgentStatus, EStepEnd, type RosterWire } from '@dltech/atlas-wire'
import { RuntimeSessionActivity } from '../runtime-session-activity'

const threadId = toThreadId('root')
const arrange = (over: Partial<ConstructorParameters<typeof RuntimeSessionActivity>[0]> = {}) =>
  new RuntimeSessionActivity({
    runtimeId: 'runtime',
    log: { refresh: async () => {}, readOwn: async () => [] },
    input: { pending: () => null },
    channel: createDeltaChannel(),
    roster: { read: async () => ({ agents: [], shells: [] }), subscribe: () => () => {} },
    ...over,
  })

const event = ({ body, seq }: { body: EventDraft; seq: number }): Event => ({
  id: toEventId(`event-${seq}`),
  seq,
  threadId,
  runId: toRunId('run'),
  depth: 0,
  at: '2026-10-31T00:00:00Z',
  ...body,
})

describe('runtime session activity', () => {
  it('starts with no observed invocation and records a genuine completed run', async () => {
    const activity = arrange()
    expect(await activity.read({ threadId })).toEqual({
      runtimeId: 'runtime',
      revision: 0,
      turnEpoch: 0,
      working: false,
      awaiting: null,
      observedOutcome: null,
    })
    activity.turnStarted({ threadId })
    expect(await activity.read({ threadId })).toMatchObject({ turnEpoch: 1, working: true })
    activity.turnOutcome({
      threadId,
      outcome: { status: ETurnStatus.Completed, runId: toRunId('actual') },
    })
    activity.turnEnded({ threadId })
    expect(await activity.read({ threadId })).toMatchObject({
      turnEpoch: 1,
      working: false,
      observedOutcome: { identity: { kind: 'run', runId: 'actual' }, outcome: 'completed' },
    })
    activity.turnStarted({ threadId })
    expect(await activity.read({ threadId })).toMatchObject({ turnEpoch: 2, observedOutcome: null })
    activity.close()
  })

  it('full-rereads first and consecutive approvals and same-head replacement with actual input precedence', async () => {
    let events = [
      event({
        body: { type: 'approval-requested', callId: toCallId('call'), reason: 'permission' },
        seq: 1,
      }),
    ]
    let waiting = false
    let refreshed = false
    const activity = arrange({
      log: {
        refresh: async () => {
          refreshed = true
        },
        readOwn: async (args) => {
          expect(refreshed).toBe(true)
          expect(args.fromSeq).toBeUndefined()
          refreshed = false
          return events
        },
      },
      input: {
        pending: () =>
          waiting ? { requestId: 'input', description: 'Code', path: '/code' } : null,
      },
    })
    expect(await activity.read({ threadId })).toMatchObject({ awaiting: 'approval' })
    waiting = true
    expect(await activity.read({ threadId })).toMatchObject({ awaiting: 'input' })
    events.push(
      event({
        body: { type: 'approval-answered', callId: toCallId('call'), decision: EDecision.Allow },
        seq: 2,
      }),
    )
    waiting = false
    expect(await activity.read({ threadId })).toMatchObject({ awaiting: null })
    events = [
      event({
        body: { type: 'approval-requested', callId: toCallId('replacement'), reason: 'new' },
        seq: 2,
      }),
    ]
    expect(await activity.read({ threadId })).toMatchObject({ awaiting: 'approval' })
    events = []
    expect(await activity.read({ threadId })).toMatchObject({ awaiting: null })
    activity.close()
  })

  it('retains genuine terminal observation while background work holds working', async () => {
    let agents: RosterWire['agents'] = [
      {
        agentId: 'child' as RosterWire['agents'][number]['agentId'],
        spawnedBy: 'root' as RosterWire['agents'][number]['spawnedBy'],
        agentType: 'builder',
        intent: 'build',
        status: EAgentStatus.Running,
        turns: 0,
        toolCalls: 0,
        lastTool: undefined,
        startedAt: '',
        endedAt: undefined,
      },
    ]
    const activity = arrange({
      roster: { read: async () => ({ agents, shells: [] }), subscribe: () => () => {} },
    })
    activity.turnStarted({ threadId })
    activity.turnOutcome({
      threadId,
      outcome: { status: ETurnStatus.Interrupted, runId: toRunId('stopped'), committed: false },
    })
    activity.turnEnded({ threadId })
    expect(await activity.read({ threadId })).toMatchObject({
      working: true,
      observedOutcome: { outcome: 'stopped' },
    })
    agents = []
    expect(await activity.read({ threadId })).toMatchObject({
      working: false,
      observedOutcome: { outcome: 'stopped' },
    })
    activity.close()
  })

  it('does not infer terminal outcomes from paused, idle, relocation or channel step ends', async () => {
    const channel = createDeltaChannel()
    const activity = arrange({ channel })
    for (const outcome of [
      {
        status: ETurnStatus.Paused,
        runId: toRunId('paused'),
        callId: toCallId('call'),
        reason: 'approval',
      },
      { status: ETurnStatus.Idle, runId: toRunId('idle') },
      { status: ETurnStatus.RelocationPaused, runId: toRunId('relocation') },
    ] as const) {
      activity.turnStarted({ threadId })
      activity.turnOutcome({ threadId, outcome })
      activity.turnEnded({ threadId })
      expect(await activity.read({ threadId })).toMatchObject({
        working: false,
        observedOutcome: null,
      })
    }
    channel.publisherFor({ threadId }).close({ end: EStepEnd.Completed })
    expect(await activity.read({ threadId })).toMatchObject({
      working: false,
      observedOutcome: null,
    })
    activity.close()
  })

  it('retries a fresh capture when a genuine invocation starts across the awaited own-log read', async () => {
    const gate = Promise.withResolvers<void>()
    let reads = 0
    const activity = arrange({
      log: {
        refresh: async () => {},
        readOwn: async () => {
          reads += 1
          if (reads === 1) await gate.promise
          return []
        },
      },
    })
    const reading = activity.read({ threadId })
    await Promise.resolve()
    activity.turnStarted({ threadId })
    gate.resolve()
    expect(await reading).toMatchObject({ turnEpoch: 1, working: true })
    expect(reads).toBe(2)
    activity.close()
  })

  it('refuses failed initialization and an unsteady capture instead of claiming idle', async () => {
    const failed = arrange({
      log: {
        refresh: async () => {
          throw new Error('unreadable')
        },
        readOwn: async () => [],
      },
    })
    await expect(failed.read({ threadId })).rejects.toThrow('unreadable')
    failed.close()
    const rosterFailed = arrange({
      roster: {
        read: async () => {
          throw new Error('roster unavailable')
        },
        subscribe: () => () => {},
      },
    })
    await expect(rosterFailed.read({ threadId })).rejects.toThrow('roster unavailable')
    rosterFailed.close()
    const inputFailed = arrange({
      input: {
        pending: () => {
          throw new Error('input unavailable')
        },
      },
    })
    await expect(inputFailed.read({ threadId })).rejects.toThrow('input unavailable')
    inputFailed.close()
    const unstable = arrange({
      log: { refresh: async () => unstable.turnStarted({ threadId }), readOwn: async () => [] },
    })
    await expect(unstable.read({ threadId })).rejects.toThrow('Activity changed while reading')
    unstable.close()
  })
})
