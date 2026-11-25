import { describe, expect, it } from 'bun:test'
import {
  EEffort,
  EToolEffect,
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

import { flushUntil, makeRig, seedSession, THREAD_ID } from './holder-rig'
import { RIG_MODEL_CHOICE } from './rig-runtime'

const CHILD_BRIEF = 'PIN-BRIEF read the thing'
const SECOND_BRIEF = 'PIN-SECOND read it again'
const SPAWN_PROBE = 'pin_spawn_probe'
const SAY_PROBE = 'pin_say_probe'

const LATER_MODEL_CHOICE = {
  ref: { providerId: 'openai', modelId: 'gpt-5' },
  effort: EEffort.High,
  fast: true,
}

type ProbeState = { agentId: string | undefined }

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
      intent: 'pin',
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
    await this.ctx.crew.say({ agentId, text: SECOND_BRIEF })
    return { ok: true, output: {}, modelText: 'said' }
  }
}

const pinProbePlugin = (state: ProbeState): Plugin =>
  definePlugin({
    name: 'pin-probe',
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

const pinRig = async (scripts: {
  parent: readonly ScriptedModelStep[]
  child: readonly ScriptedModelStep[]
}) => {
  const state: ProbeState = { agentId: undefined }
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
    plugins: composePlugins([pinProbePlugin(state)]),
    model: () => model,
  })
  await seedSession(rig)
  await rig.holder.start()
  return { rig }
}

const eventsIn = async (
  rig: Awaited<ReturnType<typeof makeRig>>,
  threadId: string,
): Promise<RecordEvent[]> =>
  (
    await rig.plane.readEvents({
      threadId: threadId as typeof THREAD_ID,
      afterSeq: 0,
      limit: 500,
      visible: false,
    })
  ).events

const childIdOf = (events: readonly RecordEvent[]): string => {
  const spawned = events.find((event) => event.type === 'agent-spawned')
  if (spawned === undefined || spawned.type !== 'agent-spawned') throw new Error('no spawn')
  return spawned.agentId
}

const saidTexts = (events: readonly RecordEvent[]): string[] =>
  events.flatMap((event) =>
    event.type === 'assistant-said'
      ? event.parts.flatMap((part) => (part.type === 'text' ? [part.text] : []))
      : [],
  )

describe('a sub-agent’s spawn model', () => {
  it('rebuilds a restarted runner on the model it was spawned with', async () => {
    const { rig } = await pinRig({
      parent: [
        { calls: [{ callId: 'c1', name: SPAWN_PROBE, input: {} }] },
        { calls: [{ callId: 'c0', name: 'bash', input: { command: 'sleep 0.5' } }] },
        { calls: [{ callId: 'c2', name: SAY_PROBE, input: {} }] },
        { text: 'saw the second answer' },
      ],
      child: [{ text: 'child answer' }, { text: 'child second' }],
    })

    await rig.post('spawn one')
    await rig.wake()
    const spawned = await flushUntil({
      check: async () =>
        (await eventsIn(rig, THREAD_ID)).some((event) => event.type === 'agent-spawned'),
      clock: rig.clock,
    })
    expect(spawned).toBe(true)
    const childId = childIdOf(await eventsIn(rig, THREAD_ID))
    const answered = await flushUntil({
      check: async () => saidTexts(await eventsIn(rig, childId)).length === 1,
      clock: rig.clock,
    })
    expect(answered).toBe(true)
    const runtime = rig.runtimes[0]
    if (runtime === undefined) throw new Error('no runtime')
    runtime.modelChoice = LATER_MODEL_CHOICE

    const answeredAgain = await flushUntil({
      check: async () => saidTexts(await eventsIn(rig, childId)).length === 2,
      attempts: 1500,
      clock: rig.clock,
    })
    expect(answeredAgain).toBe(true)
    expect(rig.runtimes.length).toBe(1)
    expect(saidTexts(await eventsIn(rig, childId))).toEqual(['child answer', 'child second'])
    expect(runtime.modelOfCalls).toEqual([RIG_MODEL_CHOICE, RIG_MODEL_CHOICE])
  })
})
