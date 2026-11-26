import { describe, expect, it } from 'bun:test'

import { ControlPlane } from '@dltech/atlas-control'
import { InMemoryControlStore } from '@dltech/atlas-control/testing'
import {
  EAgentStart,
  EAgentStatus,
  EMPTY_PROMPT,
  EProviderFailureKind,
  EProviderFailureScope,
  EProviderRetry,
  EToolEffect,
  defaultPipeline,
  refKey,
  toThreadId,
  type ModelPort,
  type ModelRef,
  type RecordEvent,
} from '@dltech/atlas-core'
import { ScriptedModel, SequentialIds, fakeToolRegistry } from '@dltech/atlas-agent/testing'

import { RIG_MODEL_CHOICE } from '../../__tests__/rig-runtime'
import { derivedIdOf } from '../../derived-id'
import type { HeldSessionDeps } from '../../held-session-deps'
import type { HostTimers, SessionRuntime } from '../../ports'
import type { SessionRecord } from '../../record/record-adapter'
import { RecordBookkeeping } from '../../record/record-bookkeeping'
import { CrewRoom } from '../crew-room'

const SESSION = 'session-replay'
const PARENT = toThreadId('thread-replay-parent')
const CALL = '11111111-1111-4111-8111-111111111111'
const STEP_KEY = `${CALL}.0`
const CHILD = toThreadId(derivedIdOf(`agent:${STEP_KEY}`))
const AT = '2026-01-01T00:00:00.000Z'

const timers: HostTimers = {
  now: () => Date.parse(AT),
  setTimeout: () => 0,
  clearTimeout: () => {},
  random: () => 0.5,
}

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

const parentEvents = (): readonly RecordEvent[] =>
  [
    {
      type: 'fact-recorded',
      key: STEP_KEY,
      kind: 'effect-started',
      value: { op: 'host.agent.spawn', digest: 'digest' },
    },
    {
      type: 'agent-spawned',
      agentId: CHILD,
      agentType: 'explore',
      intent: 'replay',
      mode: EAgentStart.Fresh,
    },
  ].map((body, index) => ({
    ...body,
    id: `e${index + 1}`,
    seq: index + 1,
    threadId: PARENT,
    at: AT,
  })) as unknown as readonly RecordEvent[]

const parentRecordOf = (): SessionRecord => {
  const events = parentEvents()
  const bookkeeping = new RecordBookkeeping()
  for (const event of events) bookkeeping.step(event)
  return {
    ownEvents: async () => events,
    eventCache: () => ({
      eventsAfter: () => [],
      loopState: () => ({}),
      bookkeeping: () => bookkeeping,
    }),
    append: async () => [],
  } as unknown as SessionRecord
}

const gateOf = () => {
  let open: () => void = () => undefined
  const gate = new Promise<void>((resolve) => {
    open = resolve
  })
  return { gate, open: () => open() }
}

const gatedModelOf = (gate: Promise<void>): ModelPort => {
  const model = new ScriptedModel([{ text: 'the child answered' }])
  return {
    identity: model.identity,
    step: async (stepArgs) => {
      await gate
      return await model.step(stepArgs)
    },
  }
}

const rigOf = async (args: { model: ModelPort }) => {
  const plane = new ControlPlane({ store: new InMemoryControlStore({ clock: () => AT }) })
  await plane.createSession({
    sessionId: SESSION,
    userId: 'user-1',
    projectId: 'project-1',
    mainThreadId: PARENT,
  })
  const lease = await plane.grant({ sessionId: SESSION, hostId: 1 })
  await plane.createThread({ threadId: CHILD, sessionId: SESSION })
  const room = new CrewRoom({
    deps: depsOf(plane),
    runtime: runtimeOf(args.model),
    parentRecord: parentRecordOf(),
    parentThreadId: PARENT,
    epoch: lease.epoch,
    signal: new AbortController().signal,
    onLeaseLost: () => undefined,
  })
  return { plane, room }
}

const childLogOf = async (plane: ControlPlane) =>
  (await plane.readEvents({ threadId: CHILD, afterSeq: 0, limit: 50, visible: true })).events

const parentInboxOf = async (plane: ControlPlane) =>
  await plane.readInbox({ sessionId: SESSION, afterId: 0, limit: 50, forThread: null })

describe('a spawn replayed over a child whose log is empty', () => {
  it('posts its brief and runs the child instead of reporting it lost', async () => {
    const gate = gateOf()
    const { plane, room } = await rigOf({ model: gatedModelOf(gate.gate) })
    const spawned = await room.spawn({
      agentId: CHILD,
      agentType: 'explore',
      intent: 'replay',
      prompt: 'read the plan',
    })
    const log = await childLogOf(plane)
    const said = JSON.stringify(log)
    expect(said).toContain('read the plan')
    expect(spawned.agentId).toBe(CHILD)
    expect(spawned.status).toBe(EAgentStatus.Running)
    expect(room.members().map((member) => member.agentId)).toContain(CHILD)
    expect(await parentInboxOf(plane)).toHaveLength(0)
    gate.open()
    await room.stopAll()
  })

  it('names the brief it posted so a second replay delivers it once', async () => {
    const gate = gateOf()
    const { plane, room } = await rigOf({ model: gatedModelOf(gate.gate) })
    const spawn = {
      agentId: CHILD,
      agentType: 'explore',
      intent: 'replay',
      prompt: 'read the plan',
    }
    await room.spawn(spawn)
    await room.spawn(spawn)
    const log = await childLogOf(plane)
    const briefs = log.filter((event) => event.type === 'user-said')
    expect(briefs).toHaveLength(1)
    expect(JSON.stringify(briefs[0])).toContain('read the plan')
    gate.open()
    await room.stopAll()
  })
})
