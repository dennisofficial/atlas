import { describe, expect, it } from 'bun:test'

import {
  EProviderFailureKind,
  EProviderFailureScope,
  EProviderRetry,
  ERunFailureKind,
  EToolEffect,
  ToolDefinition,
  type ModelPort,
  type ToolOutcome,
  type RecordEvent,
} from '@dltech/atlas-core'
import { ScriptedModel, type ScriptedModelStep } from '@dltech/atlas-agent/testing'
import {
  composePlugins,
  definePlugin,
  type Plugin,
  type PluginPodContext,
} from '@dltech/atlas-plugin-sdk'
import { z } from 'zod'

import { DRAIN_IN_FLIGHT_CAP_MS } from '../drain-cap'
import { flushUntil, makeRig, seedSession, SESSION, THREAD_ID, type HolderRig } from './holder-rig'

const CHILD_BRIEF = 'CHILD-RETRY-BRIEF take the first pass'
const CHILD_ANSWER = 'child after the retry'
const SPAWN_PROBE = 'retry_spawn_probe'
const CALL_ID = 'c1'
const PARENT_STEPS: readonly ScriptedModelStep[] = [
  { calls: [{ callId: 'p1', name: SPAWN_PROBE, input: {} }] },
  { text: 'parent done' },
  { text: 'parent idle' },
]
const FAILING_CHILD: readonly ScriptedModelStep[] = [
  { calls: [{ callId: CALL_ID, name: 'bash', input: { command: 'echo run >> runs' } }] },
  { throws: new Error('the key was revoked') },
]

const authFailure = ({ message }: { message: string }) => ({
  kind: EProviderFailureKind.Auth,
  scope: EProviderFailureScope.Credential,
  retry: EProviderRetry.Never,
  message,
})

type SpawnState = { agentId: string | undefined }

class SpawnProbe extends ToolDefinition {
  readonly name = SPAWN_PROBE
  readonly description = 'spawn a sub-agent through the crew port'
  readonly effect = EToolEffect.Write
  readonly inputSchema = z.object({})

  constructor(
    private readonly ctx: PluginPodContext,
    private readonly state: SpawnState,
  ) {
    super()
  }

  async invoke(): Promise<ToolOutcome> {
    const snapshot = await this.ctx.crew.spawn({
      agentType: 'general-purpose',
      intent: 'retry',
      prompt: CHILD_BRIEF,
    })
    this.state.agentId = snapshot.agentId
    return { ok: true, output: { agentId: snapshot.agentId }, modelText: 'spawned' }
  }
}

const spawnPlugin = (state: SpawnState): Plugin =>
  definePlugin({
    name: 'retry-spawn-probe',
    events: [],
    views: [],
    commands: [],
    pod: {
      childDeny: [SPAWN_PROBE],
      tools: (ctx) => [new SpawnProbe(ctx, state)],
      prompts: [],
    },
    control: { hooks: [], commands: new Map() },
    client: { hooks: [] },
    transport: 'none',
  })

const eventsIn = async (rig: HolderRig, threadId: string): Promise<RecordEvent[]> =>
  (
    await rig.plane.readEvents({
      threadId: threadId as typeof THREAD_ID,
      afterSeq: 0,
      limit: 400,
      visible: false,
    })
  ).events

const saidIn = (events: readonly RecordEvent[]): string[] =>
  events.flatMap((event) =>
    event.type === 'assistant-said'
      ? event.parts.flatMap((part) => (part.type === 'text' ? [part.text] : []))
      : [],
  )

const agentIdIn = (events: readonly RecordEvent[]): string => {
  const spawned = events.find((event) => event.type === 'agent-spawned')
  if (spawned === undefined || spawned.type !== 'agent-spawned') throw new Error('no spawn')
  return spawned.agentId
}

const endingQueued = async (rig: HolderRig): Promise<boolean> =>
  (await rig.plane.readInbox({ sessionId: SESSION, afterId: 0, limit: 200 })).some(
    (entry) => entry.kind === 'event' && entry.payload.includes('"agent-ended"'),
  )

const childFailed = async (rig: HolderRig, agentId: string): Promise<boolean> =>
  (await eventsIn(rig, agentId)).some(
    (event) => event.type === 'run-failed' && event.failure.kind === ERunFailureKind.Auth,
  )

describe('a retry that names a sub-agent', () => {
  it('restarts that sub-agent and starts no main-thread turn', async () => {
    const state: SpawnState = { agentId: undefined }
    const parent = new ScriptedModel([
      { calls: [{ callId: 'p1', name: SPAWN_PROBE, input: {} }] },
      { text: 'parent done' },
      { text: 'parent idle' },
    ])
    const child = new ScriptedModel([
      { calls: [{ callId: CALL_ID, name: 'bash', input: { command: 'echo run >> runs' } }] },
      { throws: new Error('the key was revoked') },
      { text: 'child after the retry' },
    ])
    const model: ModelPort = {
      identity: parent.identity,
      step: async (step) =>
        JSON.stringify(step.assembled).includes(CHILD_BRIEF)
          ? await child.step(step)
          : await parent.step(step),
    }
    const rig = await makeRig({
      plugins: composePlugins([spawnPlugin(state)]),
      model: () => model,
      normalizeFailure: authFailure,
    })
    await seedSession(rig)
    await rig.holder.start()
    await rig.post('spawn one')
    await rig.wake()
    const spawned = await flushUntil({
      check: async () =>
        (await eventsIn(rig, THREAD_ID)).some((event) => event.type === 'agent-spawned'),
      clock: rig.clock,
      advanceMs: 60_000,
      attempts: 200,
    })
    expect(spawned).toBe(true)
    const agentId = agentIdIn(await eventsIn(rig, THREAD_ID))
    expect(
      await flushUntil({
        check: async () => await childFailed(rig, agentId),
        clock: rig.clock,
        advanceMs: 60_000,
        attempts: 200,
      }),
    ).toBe(true)
    expect(
      await flushUntil({
        check: async () => await endingQueued(rig),
        clock: rig.clock,
        advanceMs: 60_000,
        attempts: 200,
      }),
    ).toBe(true)
    await rig.wake()
    expect(
      await flushUntil({
        check: async () =>
          (await eventsIn(rig, THREAD_ID)).some(
            (event) => event.type === 'agent-ended' && event.agentId === agentId,
          ),
        clock: rig.clock,
        advanceMs: 60_000,
        attempts: 200,
      }),
    ).toBe(true)
    await rig.flush()
    const parentBefore = await eventsIn(rig, THREAD_ID)
    const childBefore = await eventsIn(rig, agentId)

    await rig.plane.post({
      sessionId: SESSION,
      kind: 'retry',
      payload: JSON.stringify({ agentId }),
    })
    await rig.wake()
    expect(
      await flushUntil({
        check: async () => saidIn(await eventsIn(rig, agentId)).length === 1,
        clock: rig.clock,
        advanceMs: 60_000,
        attempts: 200,
      }),
    ).toBe(true)

    const parentAfter = await eventsIn(rig, THREAD_ID)
    const childAfter = await eventsIn(rig, agentId)
    expect(parentAfter.filter((event) => event.type === 'agent-restarted')).toMatchObject([
      { agentId, via: 'message' },
    ])
    expect(saidIn(childAfter)).toEqual(['child after the retry'])
    expect(parentAfter.filter((event) => event.type === 'turn-started')).toHaveLength(
      parentBefore.filter((event) => event.type === 'turn-started').length,
    )
    expect(childAfter.filter((event) => event.type === 'user-said')).toHaveLength(
      childBefore.filter((event) => event.type === 'user-said').length,
    )
    expect(parentAfter.filter((event) => event.type === 'user-said')).toHaveLength(
      parentBefore.filter((event) => event.type === 'user-said').length,
    )
  })
})

const modelOf = (childSteps: readonly ScriptedModelStep[]): ModelPort => {
  const parent = new ScriptedModel([...PARENT_STEPS])
  const child = new ScriptedModel([...childSteps])
  return {
    identity: parent.identity,
    step: async (step) =>
      JSON.stringify(step.assembled).includes(CHILD_BRIEF)
        ? await child.step(step)
        : await parent.step(step),
  }
}

const rigWithChild = async (args: {
  childSteps: readonly ScriptedModelStep[]
  shared?: HolderRig | undefined
}): Promise<HolderRig> => {
  const state: SpawnState = { agentId: undefined }
  const shared = args.shared
  const model = modelOf(args.childSteps)
  return await makeRig({
    plugins: composePlugins([spawnPlugin(state)]),
    model: () => model,
    normalizeFailure: authFailure,
    ...(shared === undefined
      ? {}
      : {
          plane: shared.plane,
          store: shared.store,
          bus: shared.bus,
          clock: shared.clock,
          daemon: shared.daemon,
        }),
  })
}

const spawnFailingChild = async (rig: HolderRig): Promise<string> => {
  await rig.holder.start()
  await rig.post('spawn one')
  await rig.wake()
  expect(
    await flushUntil({
      check: async () =>
        (await eventsIn(rig, THREAD_ID)).some((event) => event.type === 'agent-spawned'),
      clock: rig.clock,
      advanceMs: 60_000,
      attempts: 200,
    }),
  ).toBe(true)
  const agentId = agentIdIn(await eventsIn(rig, THREAD_ID))
  expect(
    await flushUntil({
      check: async () => await childFailed(rig, agentId),
      clock: rig.clock,
      advanceMs: 60_000,
      attempts: 200,
    }),
  ).toBe(true)
  expect(
    await flushUntil({
      check: async () => await endingQueued(rig),
      clock: rig.clock,
      advanceMs: 60_000,
      attempts: 200,
    }),
  ).toBe(true)
  await rig.wake()
  expect(
    await flushUntil({
      check: async () =>
        (await eventsIn(rig, THREAD_ID)).some(
          (event) => event.type === 'agent-ended' && event.agentId === agentId,
        ),
      clock: rig.clock,
      advanceMs: 60_000,
      attempts: 200,
    }),
  ).toBe(true)
  await rig.flush()
  return agentId
}

const handOff = async (rig: HolderRig): Promise<void> => {
  const draining = rig.holder.drain()
  await rig.flush()
  rig.clock.advance(DRAIN_IN_FLIGHT_CAP_MS)
  await draining
}

const restartedIn = async (rig: HolderRig, agentId: string): Promise<RecordEvent[]> =>
  (await eventsIn(rig, THREAD_ID)).filter(
    (event) => event.type === 'agent-restarted' && event.agentId === agentId,
  )

describe('a sub-agent that failed on a credential', () => {
  it('is not restarted by a takeover, only by a retry that names it', async () => {
    const a = await rigWithChild({ childSteps: FAILING_CHILD })
    await seedSession(a)
    const agentId = await spawnFailingChild(a)
    await a.flush()
    await handOff(a)

    const b = await rigWithChild({ childSteps: [{ text: CHILD_ANSWER }], shared: a })
    await b.holder.start()
    await a.bus.wake(SESSION)
    await b.wake()
    await b.flush()
    b.clock.advance(60_000)
    await b.flush()

    expect(await restartedIn(b, agentId)).toEqual([])
    expect(saidIn(await eventsIn(b, agentId))).toEqual([])

    await b.plane.post({ sessionId: SESSION, kind: 'retry', payload: JSON.stringify({ agentId }) })
    await b.wake()
    expect(
      await flushUntil({
        check: async () => saidIn(await eventsIn(b, agentId)).length === 1,
        clock: b.clock,
        advanceMs: 60_000,
        attempts: 200,
      }),
    ).toBe(true)
    expect(await restartedIn(b, agentId)).toMatchObject([{ via: 'message' }])
    expect(saidIn(await eventsIn(b, agentId))).toEqual([CHILD_ANSWER])
  })
})
