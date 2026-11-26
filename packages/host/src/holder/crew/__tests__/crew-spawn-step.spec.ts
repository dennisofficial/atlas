import { describe, expect, it } from 'bun:test'

import { ControlPlane } from '@dltech/atlas-control'
import { InMemoryControlStore } from '@dltech/atlas-control/testing'
import {
  EMPTY_PROMPT,
  EAgentStart,
  EProviderFailureKind,
  EProviderFailureScope,
  EProviderRetry,
  EToolEffect,
  defaultPipeline,
  refKey,
  toRunId,
  toThreadId,
  type EventDraft,
  type ModelPort,
  type ModelRef,
  type RecordEvent,
  type ThreadId,
} from '@dltech/atlas-core'
import { ScriptedModel, SequentialIds, fakeToolRegistry } from '@dltech/atlas-agent/testing'

import { runInCallScope } from '../../../calls/call-scope'
import { RIG_MODEL_CHOICE } from '../../__tests__/rig-runtime'
import type { HeldSessionDeps } from '../../held-session-deps'
import type { HostTimers, SessionRuntime } from '../../ports'
import { RecordBookkeeping } from '../../record/record-bookkeeping'
import type { SessionRecord } from '../../record/record-adapter'
import { CrewRoom } from '../crew-room'
import { openChildren } from '../open-children'
import { spawnAgentIdOf } from '../spawn-key'

const SESSION = 'session-spawn-step'
const PARENT = toThreadId('thread-spawn-step-parent')
const CALL = 'call-1'
const AT = '2026-11-26T10:00:00.000Z'
const BRIEF = 'SPAWN-BRIEF read the thing'
const OTHER_BRIEF = 'SPAWN-BRIEF read the other thing'
const CHILD_TEXT = 'SPAWN-ANSWER done'

const timers: HostTimers = {
  now: () => Date.now(),
  setTimeout: (handler, ms) => setTimeout(handler, ms),
  clearTimeout: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
  random: () => 0.5,
}

const childModelOf = (): ModelPort => new ScriptedModel([{ text: CHILD_TEXT }])

const runtimeOf = (model: ModelPort): SessionRuntime =>
  ({
    model,
    modelOf: () => model,
    modelChoice: RIG_MODEL_CHOICE,
    choiceFor: (request: { root?: typeof RIG_MODEL_CHOICE }) => request.root ?? RIG_MODEL_CHOICE,
    modelLabelOf: (ref: ModelRef) => refKey(ref),
    tools: fakeToolRegistry([]),
    daemonTools: new Set<string>(),
    effectOf: () => EToolEffect.Read,
    assembly: defaultPipeline({ prompt: () => EMPTY_PROMPT, launchDirectory: '/w' }),
    normalizeFailure: ({ message }: { message: string }) => ({
      kind: EProviderFailureKind.Network,
      scope: EProviderFailureScope.Route,
      retry: EProviderRetry.Transient,
      message,
    }),
    launchDirectory: '/w',
    remoteCalls: {
      invoke: async () => {
        throw new Error('no daemon in this spec')
      },
      onEvent: () => () => undefined,
    },
  }) as unknown as SessionRuntime

const depsOf = (plane: ControlPlane): HeldSessionDeps =>
  ({
    sessionId: SESSION,
    plane,
    ids: new SequentialIds(),
    timers,
    appendRetryMs: 5,
    bus: {
      live: async () => undefined,
      panelHold: async () => undefined,
      onWake: () => () => undefined,
      onResync: () => () => undefined,
      onPanelHold: () => () => undefined,
    },
  }) as unknown as HeldSessionDeps

const parentRecordOf = (): { record: SessionRecord; events: RecordEvent[] } => {
  const book = new RecordBookkeeping()
  const events: RecordEvent[] = []
  const record = {
    ownEvents: async () => [...events],
    eventCache: () => ({
      eventsAfter: () => [...events],
      loopEventsAfter: () => [],
      loopState: () => ({}),
      bookkeeping: () => book,
    }),
    append: async (args: { drafts: readonly EventDraft[] }) => {
      for (const draft of args.drafts) {
        const event = {
          ...draft,
          id: `e${events.length + 1}`,
          seq: events.length + 1,
          threadId: PARENT,
          at: AT,
        } as RecordEvent
        events.push(event)
        book.step(event)
      }
      return []
    },
  } as unknown as SessionRecord
  return { record, events }
}

const countingPlaneOf = (plane: ControlPlane): { plane: ControlPlane; created: string[] } => {
  const created: string[] = []
  const counting = new Proxy(plane, {
    get: (target, property) => {
      const value = Reflect.get(target, property)
      if (property !== 'createThread')
        return typeof value === 'function' ? value.bind(target) : value
      return async (params: { threadId: string; sessionId: string }) => {
        created.push(params.threadId)
        return target.createThread(params)
      }
    },
  })
  return { plane: counting, created }
}

const rigOf = async () => {
  const store = new InMemoryControlStore({ clock: () => new Date().toISOString() })
  const bare = new ControlPlane({ store })
  await bare.createSession({
    sessionId: SESSION,
    userId: 'user-1',
    projectId: 'project-1',
    mainThreadId: PARENT,
  })
  const lease = await bare.grant({ sessionId: SESSION, hostId: 1 })
  const { plane, created } = countingPlaneOf(bare)
  const parent = parentRecordOf()
  const room = new CrewRoom({
    deps: depsOf(plane),
    runtime: runtimeOf(childModelOf()),
    parentRecord: parent.record,
    parentThreadId: PARENT,
    epoch: lease.epoch,
    signal: new AbortController().signal,
    onLeaseLost: () => undefined,
  })
  return { plane: bare, created, parent, room, epoch: lease.epoch }
}

const spawnInStep = <T>(body: () => Promise<T>): Promise<T> =>
  runInCallScope({ scopeKey: CALL, callId: CALL, body })

const ofType = <T extends RecordEvent['type']>(
  events: readonly RecordEvent[],
  type: T,
): Extract<RecordEvent, { type: T }>[] =>
  events.filter((event): event is Extract<RecordEvent, { type: T }> => event.type === type)

const threadEventsOf = async (args: {
  plane: ControlPlane
  threadId: string
}): Promise<RecordEvent[]> => {
  const page = await args.plane.readEvents({
    threadId: args.threadId as ThreadId,
    afterSeq: 0,
    limit: 500,
    visible: false,
  })
  return [...page.events]
}

const briefsOf = async (args: { plane: ControlPlane; agentId: string }): Promise<string[]> =>
  (await threadEventsOf({ plane: args.plane, threadId: args.agentId }))
    .flatMap((event) => (event.type === 'user-said' ? [event.text] : []))
    .filter((text) => text.includes('SPAWN-BRIEF'))

const flush = async (): Promise<void> => {
  for (let index = 0; index < 20; index += 1) await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('a spawn inside a tool call', () => {
  it('opens one child when the same step runs twice in one scope replay', async () => {
    const { room, created, parent, plane } = await rigOf()

    const first = await spawnInStep(() =>
      room.spawn({ agentType: 'general-purpose', intent: 'probe', prompt: BRIEF }),
    )
    const replay = await spawnInStep(() =>
      room.spawn({ agentType: 'general-purpose', intent: 'probe', prompt: BRIEF }),
    )
    await flush()

    expect(replay.agentId).toBe(first.agentId)
    expect(created).toEqual([first.agentId])
    expect(ofType(parent.events, 'agent-spawned')).toHaveLength(1)
    expect(ofType(parent.events, 'agent-spawned')[0]).toMatchObject({
      agentId: first.agentId,
      callId: CALL,
    })
    expect(await briefsOf({ plane, agentId: first.agentId })).toEqual([BRIEF])
  })

  it('names the child after the parent thread and the step', async () => {
    const { room } = await rigOf()

    const first = await spawnInStep(() =>
      room.spawn({ agentType: 'general-purpose', intent: 'probe', prompt: BRIEF }),
    )

    expect(first.agentId).toBe(spawnAgentIdOf({ parentThreadId: PARENT, stepKey: `${CALL}.0` }))
  })

  it('opens a second child when the replayed input diverged', async () => {
    const { room, parent } = await rigOf()

    const first = await spawnInStep(() =>
      room.spawn({ agentType: 'general-purpose', intent: 'probe', prompt: BRIEF }),
    )
    const diverged = await spawnInStep(() =>
      room.spawn({ agentType: 'general-purpose', intent: 'probe', prompt: OTHER_BRIEF }),
    )

    expect(diverged.agentId).not.toBe(first.agentId)
    expect(ofType(parent.events, 'agent-spawned')).toHaveLength(2)
  })

  it('returns the snapshot of a child the takeover already adopted', async () => {
    const { room, created, parent, plane, epoch } = await rigOf()

    const first = await spawnInStep(() =>
      room.spawn({ agentType: 'general-purpose', intent: 'probe', prompt: BRIEF }),
    )
    await flush()
    const takeover = new CrewRoom({
      deps: depsOf(plane),
      runtime: runtimeOf(childModelOf()),
      parentRecord: parent.record,
      parentThreadId: PARENT,
      epoch,
      signal: new AbortController().signal,
      onLeaseLost: () => undefined,
    })
    await takeover.adoptAll([
      {
        agentId: first.agentId as ThreadId,
        agentType: 'general-purpose',
        intent: 'probe',
        group: undefined,
        spawnedAt: AT,
        worktree: undefined,
      },
    ])
    await flush()

    const replay = await spawnInStep(() =>
      takeover.spawn({ agentType: 'general-purpose', intent: 'probe', prompt: BRIEF }),
    )
    await flush()

    expect(replay.agentId).toBe(first.agentId)
    expect(created).toEqual([first.agentId])
    expect(ofType(parent.events, 'agent-spawned')).toHaveLength(1)
    expect(await briefsOf({ plane, agentId: first.agentId })).toEqual([BRIEF])
  })

  it('keeps a random child id when no tool call is in scope', async () => {
    const { room, parent } = await rigOf()

    const first = await room.spawn({ agentType: 'general-purpose', intent: 'probe', prompt: BRIEF })
    const second = await room.spawn({
      agentType: 'general-purpose',
      intent: 'probe',
      prompt: BRIEF,
    })

    expect(first.agentId).not.toBe(second.agentId)
    expect(ofType(parent.events, 'agent-spawned')).toHaveLength(2)
    expect(ofType(parent.events, 'agent-spawned').map((event) => event.callId)).toEqual([
      undefined,
      undefined,
    ])
    expect(
      parent.events.filter(
        (event) => event.type === 'fact-recorded' && event.kind === 'effect-started',
      ),
    ).toEqual([])
  })
})

describe('a host killed after its spawn was recorded and before it briefed the child', () => {
  it('opens the one child the record names, briefs it once and reports nothing lost', async () => {
    const { room, created, parent, plane } = await rigOf()
    const agentId = spawnAgentIdOf({ parentThreadId: PARENT, stepKey: `${CALL}.0` })
    await plane.createThread({ threadId: agentId, sessionId: SESSION })
    await parent.record.append({
      threadId: PARENT,
      runId: toRunId('run-spawn-window'),
      drafts: [
        {
          type: 'agent-spawned',
          agentId,
          agentType: 'general-purpose',
          intent: 'probe',
          mode: EAgentStart.Fresh,
          callId: CALL,
        },
        {
          type: 'fact-recorded',
          key: `${CALL}.0:spawned`,
          kind: 'agent-spawned',
          value: { agentId },
        },
      ],
    })
    const posted: string[] = []
    const notices = new Proxy(plane, {
      get: (target, property) => {
        const value = Reflect.get(target, property)
        if (property !== 'post') return typeof value === 'function' ? value.bind(target) : value
        return async (message: Parameters<ControlPlane['post']>[0]) => {
          posted.push(message.payload)
          return target.post(message)
        }
      },
    })

    const children = await openChildren({
      record: parent.record,
      plane: notices,
      sessionId: SESSION,
      threadId: PARENT,
    })
    expect(children).toEqual([])

    const snapshot = await spawnInStep(() =>
      room.spawn({ agentType: 'general-purpose', intent: 'probe', prompt: BRIEF }),
    )
    await flush()

    expect(snapshot.agentId).toBe(agentId)
    expect(created).toEqual([agentId])
    expect(ofType(parent.events, 'agent-spawned')).toHaveLength(1)
    expect(await briefsOf({ plane, agentId })).toEqual([BRIEF])
    expect(posted.filter((payload) => payload.includes('agent-ended'))).toEqual([])
  })
})
