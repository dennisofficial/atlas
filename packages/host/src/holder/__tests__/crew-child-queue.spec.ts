import { describe, expect, it } from 'bun:test'

import {
  EToolEffect,
  ToolDefinition,
  toThreadId,
  type ModelPort,
  type ToolOutcome,
  type V2Event,
} from '@dltech/atlas-core'
import {
  composePlugins,
  definePlugin,
  type Plugin,
  type PluginPodContext,
  type SubagentSaid,
} from '@dltech/atlas-plugin-sdk'
import { ScriptedModel } from '@dltech/atlas-agent/testing'
import { z } from 'zod'

import { flushUntil, makeRig, seedSession, SESSION, THREAD_ID } from './holder-rig'

const CHILD_BRIEF = 'QUEUE-BRIEF take the first pass'
const CHILD_ANSWER = 'QUEUE-CHILD first answer'
const STEER = 'QUEUE-STEER keep going'
const CHILD_STEERED = 'QUEUE-CHILD saw the steer'
const SPAWN_PROBE = 'queue_spawn_probe'
const SAY_PROBE = 'queue_say_probe'

type ProbeState = { agentId: string | undefined; said: SubagentSaid | undefined }

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
      intent: 'queue',
      prompt: CHILD_BRIEF,
    })
    this.state.agentId = snapshot.agentId
    return { ok: true, output: { agentId: snapshot.agentId }, modelText: 'spawned' }
  }
}

class SayProbe extends ToolDefinition {
  readonly name: string = SAY_PROBE
  readonly description = 'send another message to the spawned sub-agent'
  readonly effect = EToolEffect.Write
  readonly inputSchema = z.object({})

  constructor(
    private readonly ctx: PluginPodContext,
    private readonly state: ProbeState,
  ) {
    super()
  }

  async invoke(): Promise<ToolOutcome> {
    const agentId = this.state.agentId
    if (agentId === undefined) throw new Error('nothing was spawned')
    this.state.said = await this.ctx.crew.say({ agentId, text: STEER })
    return {
      ok: true,
      output: { queued: this.state.said?.queued === true },
      modelText: `queued ${String(this.state.said?.queued === true)}`,
    }
  }
}

const queueProbePlugin = (state: ProbeState): Plugin =>
  definePlugin({
    name: 'queue-probe',
    events: [],
    views: [],
    commands: [],
    pod: {
      childDeny: [SPAWN_PROBE],
      tools: (ctx) => [new SpawnProbe(ctx, state), new SayProbe(ctx, state)],
      prompts: [],
    },
    control: { hooks: [], commands: new Map() },
    client: { hooks: [] },
    transport: 'none',
  })

const eventsIn = async (
  rig: Awaited<ReturnType<typeof makeRig>>,
  threadId: string,
): Promise<V2Event[]> =>
  (
    await rig.plane.readEvents({
      threadId: threadId as typeof THREAD_ID,
      afterSeq: 0,
      limit: 1000,
      visible: false,
    })
  ).events

const childIdOf = (events: readonly V2Event[]): string => {
  const spawned = events.find((event) => event.type === 'agent-spawned')
  if (spawned === undefined || spawned.type !== 'agent-spawned') throw new Error('no spawn')
  return spawned.agentId
}

const saidTexts = (events: readonly V2Event[]): string[] =>
  events.flatMap((event) =>
    event.type === 'assistant-said'
      ? event.parts.flatMap((part) => (part.type === 'text' ? [part.text] : []))
      : [],
  )

const userSaidTexts = (events: readonly V2Event[]): string[] =>
  events.flatMap((event) => (event.type === 'user-said' ? [event.text] : []))

const stagedTexts = (events: readonly V2Event[], text: string): number[] =>
  events.flatMap((event) =>
    event.type === 'input-posted' && event.message?.text === text ? [event.inboxId] : [],
  )

const queuedMessages = async (args: {
  rig: Awaited<ReturnType<typeof makeRig>>
  threadId: string
}): Promise<{ inboxId: number; payload: string }[]> =>
  (
    await args.rig.plane.readInbox({
      sessionId: SESSION,
      afterId: 0,
      limit: 200,
      forThread: toThreadId(args.threadId),
    })
  )
    .filter((entry) => entry.kind === 'message')
    .map((entry) => ({ inboxId: entry.inboxId, payload: entry.payload }))

describe('a message that lands while the child is mid-step', () => {
  it('is answered on the child thread, staged before it is said', async () => {
    const state: ProbeState = { agentId: undefined, said: undefined }
    const childContexts: string[] = []
    let release: () => void = () => undefined
    const released = new Promise<void>((resolve) => {
      release = resolve
    })
    const parent = new ScriptedModel([
      { calls: [{ callId: 'c1', name: SPAWN_PROBE, input: {} }] },
      { calls: [{ callId: 'c2', name: SAY_PROBE, input: {} }] },
      { text: 'parent done' },
    ])
    const child = new ScriptedModel([{ text: CHILD_ANSWER }, { text: CHILD_STEERED }])
    const model: ModelPort = {
      identity: parent.identity,
      step: async ({ assembled, tools, signal, onChunk }) => {
        const args = { assembled, tools, signal, ...(onChunk === undefined ? {} : { onChunk }) }
        if (!JSON.stringify(assembled).includes(CHILD_BRIEF)) return parent.step(args)
        childContexts.push(JSON.stringify(assembled))
        if (childContexts.length === 1) await released
        return child.step(args)
      },
    }

    const rig = await makeRig({
      plugins: composePlugins([queueProbePlugin(state)]),
      model: () => model,
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
    const childId = childIdOf(await eventsIn(rig, THREAD_ID))

    const steered = await flushUntil({
      check: async () => stagedTexts(await eventsIn(rig, childId), STEER).length > 0,
      clock: rig.clock,
      advanceMs: 60_000,
      attempts: 200,
    })
    expect(steered).toBe(true)
    expect(userSaidTexts(await eventsIn(rig, childId))).toEqual([CHILD_BRIEF])
    expect(await queuedMessages({ rig, threadId: THREAD_ID })).toEqual([])

    release()

    const answered = await flushUntil({
      check: async () => saidTexts(await eventsIn(rig, childId)).length === 2,
      clock: rig.clock,
      advanceMs: 60_000,
      attempts: 400,
    })
    expect(answered).toBe(true)

    expect(saidTexts(await eventsIn(rig, childId))).toEqual([CHILD_ANSWER, CHILD_STEERED])
    expect(childContexts[1]).toContain(STEER)
    expect(state.said).toMatchObject({ queued: true })

    const childEvents = await eventsIn(rig, childId)
    expect(userSaidTexts(childEvents)).toEqual([CHILD_BRIEF, STEER])
    expect(childEvents.map((event) => event.type)).toEqual([
      'input-posted',
      'user-said',
      'input-posted',
      'assistant-said',
      'user-said',
      'assistant-said',
    ])
  }, 25_000)
})

describe('the first prompt of a child', () => {
  it('is staged on the child thread and drained there', async () => {
    const state: ProbeState = { agentId: undefined, said: undefined }
    const parent = new ScriptedModel([
      { calls: [{ callId: 'c1', name: SPAWN_PROBE, input: {} }] },
      { text: 'parent done' },
    ])
    const child = new ScriptedModel([{ text: CHILD_ANSWER }])
    const model: ModelPort = {
      identity: parent.identity,
      step: async ({ assembled, tools, signal, onChunk }) => {
        const args = { assembled, tools, signal, ...(onChunk === undefined ? {} : { onChunk }) }
        return JSON.stringify(assembled).includes(CHILD_BRIEF)
          ? child.step(args)
          : parent.step(args)
      },
    }
    const rig = await makeRig({
      plugins: composePlugins([queueProbePlugin(state)]),
      model: () => model,
    })
    await seedSession(rig)
    await rig.holder.start()
    await rig.post('spawn one')
    await rig.wake()

    const answered = await flushUntil({
      check: async () =>
        (await eventsIn(rig, THREAD_ID)).some((event) => event.type === 'agent-spawned') &&
        saidTexts(await eventsIn(rig, childIdOf(await eventsIn(rig, THREAD_ID)))).length === 1,
      clock: rig.clock,
      advanceMs: 60_000,
      attempts: 400,
    })
    expect(answered).toBe(true)
    const childId = childIdOf(await eventsIn(rig, THREAD_ID))

    const childEvents = await eventsIn(rig, childId)
    expect(childEvents.map((event) => event.type)).toEqual([
      'input-posted',
      'user-said',
      'assistant-said',
    ])
    expect(childEvents[0]).toMatchObject({ kind: 'message' })
    expect(userSaidTexts(childEvents)).toEqual([CHILD_BRIEF])
    expect(await queuedMessages({ rig, threadId: childId })).toEqual([])
    expect(await queuedMessages({ rig, threadId: THREAD_ID })).toEqual([])
  }, 25_000)
})
