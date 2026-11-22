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

const CHILD_BRIEF = 'PUMP-BRIEF take the first pass'
const SECOND_BRIEF = 'PUMP-SECOND do it once more'
const PROGRESS_TEXT = 'PUMP-PROGRESS half way'
const SPAWN_PROBE = 'pump_spawn_probe'
const SAY_PROBE = 'pump_say_probe'
const REPORT_PROBE = 'pump_report_probe'

type ProbeState = {
  agentId: string | undefined
  said: SubagentSaid | undefined
  reported: string | undefined
}

class SpawnProbe extends ToolDefinition {
  readonly name = SPAWN_PROBE
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
      intent: 'pump',
      prompt: CHILD_BRIEF,
    })
    this.state.agentId = snapshot.agentId
    return { ok: true, output: { agentId: snapshot.agentId }, modelText: 'spawned' }
  }
}

class SayProbe extends ToolDefinition {
  readonly name = SAY_PROBE
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
    return {
      ok: true,
      output: { queued: this.state.said?.queued === true },
      modelText: `queued ${String(this.state.said?.queued === true)}`,
    }
  }
}

class ReportProbe extends ToolDefinition {
  readonly name = REPORT_PROBE
  readonly description = 'report progress to the parent'
  readonly effect = EToolEffect.Write
  readonly inputSchema = z.object({})

  constructor(private readonly ctx: PluginPodContext) {
    super()
  }

  async invoke(): Promise<ToolOutcome> {
    await this.ctx.messages.send({ to: 'parent', text: PROGRESS_TEXT })
    return { ok: true, output: {}, modelText: 'reported' }
  }
}

const pumpProbePlugin = (state: ProbeState): Plugin =>
  definePlugin({
    name: 'pump-probe',
    events: [],
    views: [],
    commands: [],
    pod: {
      childDeny: [SPAWN_PROBE],
      tools: (ctx) => [new SpawnProbe(ctx, state), new SayProbe(ctx, state), new ReportProbe(ctx)],
      prompts: [],
      commands: new Map(),
    },
    control: { hooks: [], commands: new Map() },
    client: { hooks: [] },
    transport: 'none',
  })

const pumpRig = async (scripts: {
  parent: readonly ScriptedModelStep[]
  child: readonly ScriptedModelStep[]
}) => {
  const state: ProbeState = { agentId: undefined, said: undefined, reported: undefined }
  const parent = new ScriptedModel(scripts.parent)
  const child = new ScriptedModel(scripts.child)
  const model: ModelPort = {
    identity: parent.identity,
    step: async ({ assembled, tools, signal, onChunk }) => {
      const args = { assembled, tools, signal, ...(onChunk === undefined ? {} : { onChunk }) }
      return JSON.stringify(assembled).includes(CHILD_BRIEF) ? child.step(args) : parent.step(args)
    },
  }
  const rig = await makeRig({
    plugins: composePlugins([pumpProbePlugin(state)]),
    model: () => model,
  })
  await seedSession(rig)
  await rig.holder.start()
  return { rig, state, child }
}

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

const childIdOf = (events: readonly V2Event[]): string => {
  const spawned = events.find((event) => event.type === 'agent-spawned')
  if (spawned === undefined || spawned.type !== 'agent-spawned') throw new Error('no spawn')
  return spawned.agentId
}

const endingQueued = async (rig: Awaited<ReturnType<typeof makeRig>>): Promise<boolean> =>
  (await rig.plane.readInbox({ sessionId: SESSION, afterId: 0, limit: 200 })).some(
    (entry) => entry.kind === 'event' && entry.payload.includes('"agent-ended"'),
  )

const drainedEnding = async (
  rig: Awaited<ReturnType<typeof makeRig>>,
): Promise<readonly string[]> => {
  const queued = await flushUntil({
    check: async () => await endingQueued(rig),
    clock: rig.clock,
    advanceMs: 60_000,
    attempts: 200,
  })
  if (!queued) return []
  const notices = (await rig.plane.readInbox({ sessionId: SESSION, afterId: 0, limit: 200 }))
    .filter((entry) => entry.kind === 'event')
    .map((entry) => entry.payload)
  await rig.wake()
  const appended = await flushUntil({
    check: async () =>
      (await eventsIn(rig, THREAD_ID)).some((event) => event.type === 'agent-ended'),
    clock: rig.clock,
    advanceMs: 60_000,
    attempts: 200,
  })
  return appended ? notices : []
}

const saidTexts = (events: readonly V2Event[]): string[] =>
  events.flatMap((event) =>
    event.type === 'assistant-said'
      ? event.parts.flatMap((part) => (part.type === 'text' ? [part.text] : []))
      : [],
  )

describe('a sub-agent after its first turn', () => {
  it('restarts on an explicit say and answers again', async () => {
    const { rig, state, child } = await pumpRig({
      parent: [
        { calls: [{ callId: 'c1', name: SPAWN_PROBE, input: {} }] },
        { text: 'parent done' },
        { calls: [{ callId: 'c2', name: SAY_PROBE, input: {} }] },
        { text: 'saw the second answer' },
      ],
      child: [{ text: 'child answer' }, { text: 'child second' }],
    })

    await rig.post('spawn one')
    await rig.wake()
    const ended = await flushUntil({
      check: async () =>
        (await eventsIn(rig, THREAD_ID)).some((event) => event.type === 'agent-ended'),
      clock: rig.clock,
    })
    expect(ended).toBe(true)
    await rig.flush()
    const childId = childIdOf(await eventsIn(rig, THREAD_ID))

    await rig.post('say again')
    await rig.wake()
    const answeredAgain = await flushUntil({
      check: async () => saidTexts(await eventsIn(rig, childId)).length === 2,
      clock: rig.clock,
    })
    expect(answeredAgain).toBe(true)

    expect(state.said).toMatchObject({ queued: false })
    const parentEvents = await eventsIn(rig, THREAD_ID)
    expect(parentEvents.filter((event) => event.type === 'agent-restarted')).toMatchObject([
      { agentId: childId },
    ])
    expect(saidTexts(await eventsIn(rig, childId))).toEqual(['child answer', 'child second'])
    expect(child.requests.length).toBe(2)
  })

  it('a failed child does not restart itself while the parent idles', async () => {
    const { rig } = await pumpRig({
      parent: [
        { calls: [{ callId: 'c1', name: SPAWN_PROBE, input: {} }] },
        { text: 'parent done' },
        { text: 'parent idle' },
      ],
      child: [{ throws: new Error('boom') }],
    })

    await rig.post('spawn one')
    await rig.wake()
    const ended = await drainedEnding(rig)
    expect(ended).not.toEqual([])
    await rig.flush()
    const childId = childIdOf(await eventsIn(rig, THREAD_ID))
    const before = await eventsIn(rig, childId)

    const idled = await flushUntil({
      check: async () => saidTexts(await eventsIn(rig, THREAD_ID)).length === 2,
      clock: rig.clock,
    })
    expect(idled).toBe(true)

    const parentEvents = await eventsIn(rig, THREAD_ID)
    expect(parentEvents.filter((event) => event.type === 'agent-ended')).toMatchObject([
      { agentId: childId, status: 'failed' },
    ])
    expect(parentEvents.filter((event) => event.type === 'agent-restarted')).toEqual([])
    expect(await eventsIn(rig, childId)).toEqual(before)
    expect(saidTexts(before)).toEqual([])
  })

  it('a message to the parent reaches it, and the ending still arrives', async () => {
    const { rig } = await pumpRig({
      parent: [
        { calls: [{ callId: 'c1', name: SPAWN_PROBE, input: {} }] },
        { text: 'parent done' },
        { text: 'saw the report' },
      ],
      child: [
        { calls: [{ callId: 'r1', name: REPORT_PROBE, input: {} }] },
        { text: 'child finished' },
      ],
    })

    await rig.post('spawn one')
    await rig.wake()
    const reported = await flushUntil({
      check: async () =>
        (await eventsIn(rig, THREAD_ID)).some((event) => event.type === 'agent-reported'),
      clock: rig.clock,
      advanceMs: 60_000,
      attempts: 200,
    })
    expect(reported).toBe(true)
    const childId = childIdOf(await eventsIn(rig, THREAD_ID))

    const parentEvents = await eventsIn(rig, THREAD_ID)
    expect(parentEvents.filter((event) => event.type === 'agent-reported')).toMatchObject([
      { agentId: childId, prose: PROGRESS_TEXT },
    ])
    expect(parentEvents.filter((event) => event.type === 'agent-ended')).toMatchObject([
      { agentId: childId, status: 'finished', prose: 'child finished' },
    ])
    expect(saidTexts(parentEvents)).toContain('saw the report')
  })
})
