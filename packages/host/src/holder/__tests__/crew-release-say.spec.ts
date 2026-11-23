import { describe, expect, it } from 'bun:test'

import {
  EToolEffect,
  ToolDefinition,
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
import { ScriptedModel, type ScriptedModelStep } from '@dltech/atlas-agent/testing'
import { z } from 'zod'

import { flushUntil, makeRig, seedSession, SESSION, THREAD_ID } from './holder-rig'

const CHILD_BRIEF = 'RELEASE-BRIEF take the first pass'
const SECOND_BRIEF = 'RELEASE-SECOND go once more'
const SPAWN_PROBE = 'release_spawn_probe'
const SAY_PROBE = 'release_say_probe'
const MISSING_PROBE = 'release_missing_probe'

type ProbeState = {
  agentId: string | undefined
  said: SubagentSaid | undefined
  missing: string | undefined
}

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
      intent: 'release',
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
    this.state.said = await this.ctx.crew.say({ agentId, text: SECOND_BRIEF })
    return { ok: true, output: {}, modelText: 'said' }
  }
}

class MissingProbe extends ToolDefinition {
  readonly name: string = MISSING_PROBE
  readonly description = 'say to a thread this session does not know'
  readonly effect = EToolEffect.Write
  readonly inputSchema = z.object({})

  constructor(
    private readonly ctx: PluginPodContext,
    private readonly state: ProbeState,
  ) {
    super()
  }

  async invoke(): Promise<ToolOutcome> {
    this.state.missing = await this.ctx.crew
      .say({ agentId: 'thread-nowhere', text: SECOND_BRIEF })
      .then((said) => (said === undefined ? 'no such sub-agent' : 'unexpectedly said'))
    return { ok: true, output: {}, modelText: 'tried' }
  }
}

const releaseProbePlugin = (state: ProbeState): Plugin =>
  definePlugin({
    name: 'release-probe',
    events: [],
    views: [],
    commands: [],
    pod: {
      childDeny: [SPAWN_PROBE],
      tools: (ctx) => [
        new SpawnProbe(ctx, state),
        new SayProbe(ctx, state),
        new MissingProbe(ctx, state),
      ],
      prompts: [],
      commands: new Map(),
    },
    control: { hooks: [], commands: new Map() },
    client: { hooks: [] },
    transport: 'none',
  })

const releaseRig = async (scripts: {
  parent: readonly ScriptedModelStep[]
  child: readonly ScriptedModelStep[]
}) => {
  const state: ProbeState = { agentId: undefined, said: undefined, missing: undefined }
  const parent = new ScriptedModel(scripts.parent)
  const child = new ScriptedModel(scripts.child)
  const model: ModelPort = {
    identity: parent.identity,
    step: async (args) =>
      JSON.stringify(args.assembled).includes(CHILD_BRIEF) ? child.step(args) : parent.step(args),
  }
  const rig = await makeRig({
    plugins: composePlugins([releaseProbePlugin(state)]),
    model: () => model,
  })
  await seedSession(rig)
  await rig.holder.start()
  return { rig, state }
}

const endingQueued = async (rig: Awaited<ReturnType<typeof makeRig>>): Promise<boolean> =>
  (await rig.plane.readInbox({ sessionId: SESSION, afterId: 0, limit: 200 })).some(
    (entry) => entry.kind === 'event' && entry.payload.includes('"agent-ended"'),
  )

const eventsIn = async (
  rig: Awaited<ReturnType<typeof makeRig>>,
  threadId: string,
): Promise<V2Event[]> =>
  (
    await rig.plane.readEvents({
      threadId: threadId as typeof THREAD_ID,
      afterSeq: 0,
      limit: 500,
      visible: false,
    })
  ).events

const spawnOf = (events: readonly V2Event[]): string | undefined =>
  events.flatMap((event) => (event.type === 'agent-spawned' ? [event.agentId] : []))[0]

const childIdOf = (events: readonly V2Event[]): string => {
  const spawned = spawnOf(events)
  if (spawned === undefined) throw new Error('no spawn')
  return spawned
}

const saidTexts = (events: readonly V2Event[]): string[] =>
  events.flatMap((event) =>
    event.type === 'assistant-said'
      ? event.parts.flatMap((part) => (part.type === 'text' ? [part.text] : []))
      : [],
  )

const endingsOf = (args: { events: readonly V2Event[]; agentId: string }): V2Event[] =>
  args.events.filter((event) => event.type === 'agent-ended' && event.agentId === args.agentId)

const deliverEndings = async (args: {
  rig: Awaited<ReturnType<typeof makeRig>>
  agentId: string
  count: number
}): Promise<boolean> =>
  await flushUntil({
    check: async () => {
      const events = await eventsIn(args.rig, THREAD_ID)
      if (endingsOf({ events, agentId: args.agentId }).length >= args.count) return true
      if (await endingQueued(args.rig)) await args.rig.wake()
      return false
    },
    clock: args.rig.clock,
    attempts: 400,
  })

describe('a say to a finished sub-agent after its parent’s lease was released', () => {
  it('re-adopts the child, runs one more turn and ends it once', async () => {
    const { rig, state } = await releaseRig({
      parent: [
        { calls: [{ callId: 'c1', name: SPAWN_PROBE, input: {} }] },
        { text: 'parent done' },
        { text: 'saw the ending' },
        { calls: [{ callId: 'c2', name: SAY_PROBE, input: {} }] },
        { text: 'saw the second answer' },
        { calls: [{ callId: 'c3', name: MISSING_PROBE, input: {} }] },
        { text: 'saw the missing error' },
        { text: 'parent idle again' },
        { text: 'parent still idle' },
        { text: 'parent idles once more' },
      ],
      child: [{ text: 'child answer' }, { text: 'child second' }],
    })

    await rig.post('spawn one')
    await rig.wake()
    const answered = await flushUntil({
      check: async () => {
        const childId = spawnOf(await eventsIn(rig, THREAD_ID))
        return childId !== undefined && saidTexts(await eventsIn(rig, childId)).length === 1
      },
      clock: rig.clock,
    })
    expect(answered).toBe(true)
    const childId = childIdOf(await eventsIn(rig, THREAD_ID))

    const drained = await deliverEndings({ rig, agentId: childId, count: 1 })
    expect(drained).toBe(true)

    const released = await flushUntil({
      check: () => rig.holder.heldIds().length === 0,
      clock: rig.clock,
      advanceMs: 2_000,
      attempts: 200,
    })
    expect(released).toBe(true)
    await rig.flush()
    expect(rig.holder.heldIds()).toEqual([])
    expect(endingsOf({ events: await eventsIn(rig, THREAD_ID), agentId: childId }).length).toBe(1)

    await rig.post('say again')
    await rig.wake()
    const answeredAgain = await flushUntil({
      check: async () => saidTexts(await eventsIn(rig, childId)).length === 2,
      attempts: 1500,
      clock: rig.clock,
    })
    expect(answeredAgain).toBe(true)
    expect(await deliverEndings({ rig, agentId: childId, count: 2 })).toBe(true)
    await rig.flush()

    const parent = await eventsIn(rig, THREAD_ID)
    expect(endingsOf({ events: parent, agentId: childId })).toMatchObject([
      { status: 'finished', prose: 'child answer' },
      { status: 'finished', prose: 'child second' },
    ])
    expect(endingsOf({ events: parent, agentId: childId }).length).toBe(2)
    expect(parent.filter((event) => event.type === 'agent-restarted')).toMatchObject([
      { agentId: childId, via: 'message' },
    ])
    expect(saidTexts(await eventsIn(rig, childId))).toEqual(['child answer', 'child second'])
    expect(state.said).toMatchObject({ queued: false })
    expect(
      (await eventsIn(rig, childId)).filter(
        (event) => event.type === 'user-said' && event.text === SECOND_BRIEF,
      ).length,
    ).toBe(1)
    expect(saidTexts(parent).filter((text) => text === 'saw the second answer').length).toBe(1)
    expect(state.missing).toBe('no such sub-agent')
  }, 30_000)
})
