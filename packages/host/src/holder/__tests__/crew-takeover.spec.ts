import { describe, expect, it } from 'bun:test'

import {
  EToolEffect,
  INBOX_KIND_EVENT,
  inboxEventOf,
  ToolDefinition,
  type ModelPort,
  type ToolOutcome,
  type RecordEvent,
} from '@dltech/atlas-core'
import {
  composePlugins,
  definePlugin,
  type Plugin,
  type PluginPodContext,
} from '@dltech/atlas-plugin-sdk'
import { ScriptedModel, type ScriptedModelStep } from '@dltech/atlas-agent/testing'
import { z } from 'zod'

import { DRAIN_IN_FLIGHT_CAP_MS } from '../drain-cap'
import { flushUntil, makeRig, seedSession, SESSION, THREAD_ID } from './holder-rig'

const CHILD_BRIEF = 'TAKEOVER-BRIEF take the long way'
const CHILD_ANSWER = 'TAKEOVER-CHILD done'
const SPAWN_PROBE = 'takeover_spawn_probe'
const SAY_PROBE = 'takeover_say_probe'
const STEERING = 'TAKEOVER-STEER keep going'

type ProbeState = { agentId: string | undefined }

class SpawnProbe extends ToolDefinition {
  readonly name: string = SPAWN_PROBE
  readonly description = 'spawn a sub-agent through the crew port'
  readonly effect = EToolEffect.Write
  readonly inputSchema = z.object({})

  constructor(
    private readonly ctx: PluginPodContext,
    private readonly state: ProbeState,
  ) {
    super()
  }

  async invoke(): Promise<ToolOutcome> {
    const snapshot = await this.ctx.crew.spawn({
      agentType: 'general-purpose',
      intent: 'takeover',
      prompt: CHILD_BRIEF,
    })
    this.state.agentId = snapshot.agentId
    return { ok: true, output: { agentId: snapshot.agentId }, modelText: 'spawned' }
  }
}

class SayProbe extends ToolDefinition {
  readonly name: string = SAY_PROBE
  readonly description = 'steer a running sub-agent through the crew port'
  readonly effect = EToolEffect.Write
  readonly inputSchema = z.object({})

  constructor(
    private readonly ctx: PluginPodContext,
    private readonly state: ProbeState,
  ) {
    super()
  }

  async invoke(): Promise<ToolOutcome> {
    if (this.state.agentId === undefined) throw new Error('no sub-agent to steer')
    await this.ctx.crew.say({ agentId: this.state.agentId, text: STEERING })
    return { ok: true, output: {}, modelText: 'steered' }
  }
}

const probePlugin = (state: ProbeState): Plugin =>
  definePlugin({
    name: 'takeover-probe',
    events: [],
    views: [],
    commands: [],
    pod: {
      childDeny: [SPAWN_PROBE, SAY_PROBE],
      tools: (ctx) => [new SpawnProbe(ctx, state), new SayProbe(ctx, state)],
      prompts: [],
    },
    control: { hooks: [], commands: new Map() },
    client: { hooks: [] },
    transport: 'none',
  })

const PARENT_SCRIPT: readonly ScriptedModelStep[] = [
  { calls: [{ callId: 'c1', name: SPAWN_PROBE, input: {} }] },
  { text: 'parent waiting' },
]

const isChild = (assembled: unknown): boolean => JSON.stringify(assembled).includes(CHILD_BRIEF)

const splitModel = (args: { parent: ModelPort; child: ModelPort }): ModelPort => ({
  identity: args.parent.identity,
  step: async ({ assembled, tools, signal, onChunk }) => {
    const step = { assembled, tools, signal, ...(onChunk === undefined ? {} : { onChunk }) }
    return isChild(assembled) ? args.child.step(step) : args.parent.step(step)
  },
})

const stalledModel = (): ModelPort => {
  const parent = new ScriptedModel(PARENT_SCRIPT)
  return {
    identity: parent.identity,
    step: async ({ assembled, tools, signal, onChunk }) => {
      if (isChild(assembled)) return new Promise<never>(() => undefined)
      return parent.step({
        assembled,
        tools,
        signal,
        ...(onChunk === undefined ? {} : { onChunk }),
      })
    },
  }
}

const answeringModel = (parentScript: readonly ScriptedModelStep[]): ModelPort => {
  const parent = new ScriptedModel(parentScript)
  const child = new ScriptedModel([{ text: CHILD_ANSWER }])
  return {
    identity: parent.identity,
    step: async ({ assembled, tools, signal, onChunk }) => {
      const args = { assembled, tools, signal, ...(onChunk === undefined ? {} : { onChunk }) }
      return isChild(assembled) ? child.step(args) : parent.step(args)
    },
  }
}

const eventsIn = async (args: {
  rig: Awaited<ReturnType<typeof makeRig>>
  threadId: string
}): Promise<RecordEvent[]> =>
  (
    await args.rig.plane.readEvents({
      threadId: args.threadId as typeof THREAD_ID,
      afterSeq: 0,
      limit: 1000,
      visible: false,
    })
  ).events

const childIdOf = (events: readonly RecordEvent[]): string => {
  const spawned = events.find((event) => event.type === 'agent-spawned')
  if (spawned === undefined || spawned.type !== 'agent-spawned') throw new Error('no spawn')
  return spawned.agentId
}

const endingsOf = (args: { events: readonly RecordEvent[]; agentId: string }): RecordEvent[] =>
  args.events.filter((event) => event.type === 'agent-ended' && event.agentId === args.agentId)

const ofType = (args: { events: readonly RecordEvent[]; type: string }): RecordEvent[] =>
  args.events.filter((event) => event.type === args.type)

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const queuedEndings = async (args: {
  rig: Awaited<ReturnType<typeof makeRig>>
  agentId: string
}): Promise<number[]> =>
  (await args.rig.plane.readInbox({ sessionId: SESSION, afterId: 0, limit: 200 })).flatMap(
    (entry) => {
      if (entry.kind !== INBOX_KIND_EVENT) return []
      const read = inboxEventOf(entry.payload)
      return read.ok && read.event.type === 'agent-ended' && read.event.agentId === args.agentId
        ? [entry.inboxId]
        : []
    },
  )

const untilParentDrainsEnding = async (args: {
  rig: Awaited<ReturnType<typeof makeRig>>
  agentId: string
}): Promise<RecordEvent[]> => {
  const queued = await flushUntil({
    check: async () => (await queuedEndings(args)).length > 0,
    attempts: 200,
    clock: args.rig.clock,
    advanceMs: 5_000,
  })
  expect(queued).toBe(true)
  expect(await queuedEndings(args)).toHaveLength(1)
  await args.rig.bus.wake(SESSION)
  const events = await untilEvents({ rig: args.rig, threadId: THREAD_ID, type: 'agent-ended' })
  expect(await queuedEndings(args)).toEqual([])
  return events
}

const drainPastCap = async (rig: Awaited<ReturnType<typeof makeRig>>): Promise<void> => {
  const draining = rig.holder.drain()
  await rig.flush()
  rig.clock.advance(DRAIN_IN_FLIGHT_CAP_MS)
  await draining
}

describe('a host handoff while a sub-agent runs', () => {
  it('waits out the cap for a stalled child, leaves it unended, and the next holder resumes its turn', async () => {
    const state: ProbeState = { agentId: undefined }
    const a = await makeRig({
      plugins: composePlugins([probePlugin(state)]),
      model: stalledModel,
    })
    await seedSession(a)
    await a.holder.start()

    await a.post('spawn one')
    await a.wake()
    const spawned = await flushUntil({
      check: async () =>
        (await eventsIn({ rig: a, threadId: THREAD_ID })).some((e) => e.type === 'agent-spawned'),
      clock: a.clock,
    })
    expect(spawned).toBe(true)
    const childId = childIdOf(await eventsIn({ rig: a, threadId: THREAD_ID }))
    const stepping = await flushUntil({
      check: async () => (await eventsIn({ rig: a, threadId: childId })).length > 0,
      clock: a.clock,
    })
    expect(stepping).toBe(true)

    const before = Date.now()
    await drainPastCap(a)
    expect(Date.now() - before).toBeLessThan(2_000)

    const drained = await eventsIn({ rig: a, threadId: THREAD_ID })
    expect(endingsOf({ events: drained, agentId: childId })).toEqual([])
    const { lease } = await a.plane.currentLease({ sessionId: SESSION })
    expect(lease.holderHostId).toBeNull()
    expect(lease.wantsHolder).toBe(true)

    const b = await makeRig({
      plane: a.plane,
      store: a.store,
      bus: a.bus,
      clock: a.clock,
      daemon: a.daemon,
      plugins: composePlugins([probePlugin(state)]),
      model: () => answeringModel([{ text: 'saw the child finish' }]),
    })
    await b.holder.start()
    await a.bus.wake(SESSION)

    const resumed = await untilParentDrainsEnding({ rig: a, agentId: childId })
    expect(resumed).not.toEqual([])

    const parent = await eventsIn({ rig: a, threadId: THREAD_ID })
    expect(endingsOf({ events: parent, agentId: childId })).toMatchObject([
      { status: 'finished', prose: CHILD_ANSWER },
    ])
    expect(endingsOf({ events: parent, agentId: childId })[0]).not.toMatchObject({
      killedBy: 'unrecorded',
    })
    expect(ofType({ events: parent, type: 'agent-restarted' })).toEqual([])
    expect(
      ofType({ events: await eventsIn({ rig: a, threadId: childId }), type: 'agent-ended' }),
    ).toEqual([])
  }, 20_000)
})

const STEER_SCRIPT: readonly ScriptedModelStep[] = [
  { calls: [{ callId: 'c1', name: SPAWN_PROBE, input: {} }] },
  { calls: [{ callId: 'c2', name: SAY_PROBE, input: {} }] },
  { text: 'parent answered' },
]

const childBashScript: readonly ScriptedModelStep[] = [
  {
    calls: [
      { callId: 'child-bash', name: 'bash', input: { command: 'sleep 0.4; echo completed' } },
    ],
  },
  { text: CHILD_ANSWER },
]

const spawnedChild = async (rig: Awaited<ReturnType<typeof makeRig>>): Promise<string> => {
  const spawned = await flushUntil({
    check: async () =>
      (await eventsIn({ rig, threadId: THREAD_ID })).some((e) => e.type === 'agent-spawned'),
    clock: rig.clock,
  })
  expect(spawned).toBe(true)
  return childIdOf(await eventsIn({ rig, threadId: THREAD_ID }))
}

const untilEvents = async (args: {
  rig: Awaited<ReturnType<typeof makeRig>>
  threadId: string
  type: string
  attempts?: number
}): Promise<RecordEvent[]> => {
  const ready = await flushUntil({
    check: async () =>
      ofType({
        events: await eventsIn({ rig: args.rig, threadId: args.threadId }),
        type: args.type,
      }).length > 0,
    attempts: args.attempts ?? 200,
    clock: args.rig.clock,
    advanceMs: 5_000,
  })
  expect(ready).toBe(true)
  return ofType({
    events: await eventsIn({ rig: args.rig, threadId: args.threadId }),
    type: args.type,
  })
}

describe('a drain with a daemon call outstanding in a sub-agent', () => {
  it('detaches the call at once, and the next holder reattaches it so the child finishes', async () => {
    const state: ProbeState = { agentId: undefined }
    const a = await makeRig({
      plugins: composePlugins([probePlugin(state)]),
      model: () =>
        splitModel({
          parent: new ScriptedModel(PARENT_SCRIPT),
          child: new ScriptedModel(childBashScript),
        }),
    })
    await seedSession(a)
    await a.holder.start()

    await a.post('spawn one')
    await a.wake()
    const childId = await spawnedChild(a)
    await untilEvents({ rig: a, threadId: childId, type: 'tool-dispatched' })

    await a.holder.drain()

    const drainedChild = await eventsIn({ rig: a, threadId: childId })
    expect(ofType({ events: drainedChild, type: 'tool-result' })).toEqual([])
    expect(ofType({ events: drainedChild, type: 'nudge' })).toEqual([])
    expect(
      endingsOf({ events: await eventsIn({ rig: a, threadId: THREAD_ID }), agentId: childId }),
    ).toEqual([])

    const b = await makeRig({
      plane: a.plane,
      store: a.store,
      bus: a.bus,
      clock: a.clock,
      daemon: a.daemon,
      plugins: composePlugins([probePlugin(state)]),
      model: () => answeringModel([{ text: 'saw the child finish' }]),
    })
    await b.holder.start()
    await a.bus.wake(SESSION)
    await sleep(600)
    const results = await untilEvents({ rig: a, threadId: childId, type: 'tool-result' })
    expect(results).toMatchObject([{ callId: 'child-bash' }])
    const parent = await untilParentDrainsEnding({ rig: a, agentId: childId })
    expect(endingsOf({ events: parent, agentId: childId })).toMatchObject([
      { status: 'finished', prose: CHILD_ANSWER },
    ])
    expect(a.daemon.runCount()).toBe(1)

    const settledChild = await eventsIn({ rig: a, threadId: childId })
    const settledResults = ofType({ events: settledChild, type: 'tool-result' })
    expect(settledResults).toHaveLength(1)
    expect(
      settledResults.filter((event) => (event as { interrupted?: boolean }).interrupted === true),
    ).toEqual([])
    expect(ofType({ events: settledChild, type: 'nudge' })).toEqual([])
  }, 25_000)
})

describe('steering a sub-agent across a handoff', () => {
  it('persists accepted steering so the resumed child sees it once', async () => {
    const state: ProbeState = { agentId: undefined }
    const a = await makeRig({
      plugins: composePlugins([probePlugin(state)]),
      model: () =>
        splitModel({
          parent: new ScriptedModel(STEER_SCRIPT),
          child: stalledModel(),
        }),
    })
    await seedSession(a)
    await a.holder.start()

    await a.post('spawn one')
    await a.wake()
    const childId = await spawnedChild(a)
    await untilEvents({ rig: a, threadId: THREAD_ID, type: 'assistant-said' })

    await drainPastCap(a)

    const said = (await eventsIn({ rig: a, threadId: childId })).filter(
      (event) => event.type === 'user-said',
    )
    expect(said.flatMap((event) => (event.type === 'user-said' ? [event.text] : []))).toEqual([
      CHILD_BRIEF,
    ])
    const queued = (
      await a.plane.readEvents({
        threadId: childId as typeof THREAD_ID,
        afterSeq: 0,
        limit: 1000,
        visible: false,
      })
    ).events.filter((event) => event.type === 'input-posted' && event.message?.text === STEERING)
    expect(queued).toHaveLength(1)

    const b = await makeRig({
      plane: a.plane,
      store: a.store,
      bus: a.bus,
      clock: a.clock,
      daemon: a.daemon,
      plugins: composePlugins([probePlugin(state)]),
      model: () => answeringModel([{ text: 'saw the child finish' }]),
    })
    await b.holder.start()
    await a.bus.wake(SESSION)

    const parent = await untilParentDrainsEnding({ rig: a, agentId: childId })
    expect(endingsOf({ events: parent, agentId: childId })).toMatchObject([
      { status: 'finished', prose: CHILD_ANSWER },
    ])
    const afterSaid = (await eventsIn({ rig: a, threadId: childId })).filter(
      (event) => event.type === 'user-said',
    )
    expect(afterSaid.flatMap((event) => (event.type === 'user-said' ? [event.text] : []))).toEqual([
      CHILD_BRIEF,
      STEERING,
    ])
  }, 25_000)
})

describe('two host handoffs in a row', () => {
  it('resumes the child silently on each holder and ends it once', async () => {
    const state: ProbeState = { agentId: undefined }
    const plugins = (): ReturnType<typeof composePlugins> => composePlugins([probePlugin(state)])
    const a = await makeRig({ plugins: plugins(), model: stalledModel })
    await seedSession(a)
    await a.holder.start()

    await a.post('spawn one')
    await a.wake()
    const childId = await spawnedChild(a)
    await untilEvents({ rig: a, threadId: childId, type: 'user-said' })
    await drainPastCap(a)

    const b = await makeRig({
      plane: a.plane,
      store: a.store,
      bus: a.bus,
      clock: a.clock,
      daemon: a.daemon,
      plugins: plugins(),
      model: stalledModel,
    })
    await b.holder.start()
    await a.bus.wake(SESSION)

    const relocated = await flushUntil({
      check: () => b.holder.heldIds().length === 1,
      attempts: 200,
      clock: a.clock,
      advanceMs: 5_000,
    })
    expect(relocated).toBe(true)
    await drainPastCap(b)

    const c = await makeRig({
      plane: a.plane,
      store: a.store,
      bus: a.bus,
      clock: a.clock,
      daemon: a.daemon,
      plugins: plugins(),
      model: () => answeringModel([{ text: 'saw the child finish' }]),
    })
    await c.holder.start()
    await a.bus.wake(SESSION)

    const ended = await untilParentDrainsEnding({ rig: a, agentId: childId })
    expect(endingsOf({ events: ended, agentId: childId })).toMatchObject([
      { status: 'finished', prose: CHILD_ANSWER },
    ])
    expect(endingsOf({ events: ended, agentId: childId }).length).toBe(1)
    const parent = await eventsIn({ rig: a, threadId: THREAD_ID })
    expect(ofType({ events: parent, type: 'agent-restarted' })).toEqual([])
    expect(
      ofType({ events: await eventsIn({ rig: a, threadId: childId }), type: 'agent-ended' }),
    ).toEqual([])
  }, 30_000)
})
