import { describe, expect, it } from 'bun:test'

import {
  EToolEffect,
  ToolDefinition,
  type ModelPort,
  type RecordEvent,
  type ToolOutcome,
} from '@dltech/atlas-core'
import {
  composePlugins,
  definePlugin,
  type Plugin,
  type PluginPodContext,
} from '@dltech/atlas-plugin-sdk'
import { ScriptedModel, type ScriptedModelStep } from '@dltech/atlas-agent/testing'
import { ESpan, ESpanOutcome } from '@dltech/atlas-observability'
import { RecordingTracer } from '@dltech/atlas-observability/testing'
import { z } from 'zod'

import { flushUntil, makeRig, seedSession, THREAD_ID } from './holder-rig'

const SPAWN_PROBE = 'lose_spawn_probe'
const CHILD_BRIEF = 'LOSE-BRIEF take the long way'

class SpawnProbe extends ToolDefinition {
  readonly name: string = SPAWN_PROBE
  readonly description = 'spawn a sub-agent through the crew port'
  readonly effect = EToolEffect.Write
  readonly inputSchema = z.object({})

  constructor(private readonly ctx: PluginPodContext) {
    super()
  }

  async invoke(): Promise<ToolOutcome> {
    const snapshot = await this.ctx.crew.spawn({
      agentType: 'general-purpose',
      intent: 'lose',
      prompt: CHILD_BRIEF,
    })
    return { ok: true, output: { agentId: snapshot.agentId }, modelText: 'spawned' }
  }
}

const probePlugin = (): Plugin =>
  definePlugin({
    name: 'lose-probe',
    events: [],
    views: [],
    commands: [],
    pod: {
      childDeny: [SPAWN_PROBE],
      tools: (ctx) => [new SpawnProbe(ctx)],
      prompts: [],
    },
    control: { hooks: [], commands: new Map() },
    client: { hooks: [] },
    transport: 'none',
  })

const PARENT_SCRIPT: readonly ScriptedModelStep[] = [
  { calls: [{ callId: 'spawn-1', name: SPAWN_PROBE, input: {} }] },
  { text: 'parent waiting' },
]

const CHILD_SCRIPT: readonly ScriptedModelStep[] = [
  {
    calls: [
      {
        callId: 'child-bash',
        name: 'bash',
        input: { command: 'echo started; sleep 0.3; echo late' },
      },
    ],
  },
  { text: 'child done' },
]

const isChild = (assembled: unknown): boolean => JSON.stringify(assembled).includes(CHILD_BRIEF)

const splitModel = (
  parentScript: readonly ScriptedModelStep[],
  childScript: readonly ScriptedModelStep[],
): (() => ModelPort) => {
  const parent = new ScriptedModel(parentScript)
  const child = new ScriptedModel(childScript)
  return () => ({
    identity: parent.identity,
    step: async ({ assembled, tools, signal, onChunk }) => {
      const step = { assembled, tools, signal, ...(onChunk === undefined ? {} : { onChunk }) }
      return isChild(assembled) ? child.step(step) : parent.step(step)
    },
  })
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

describe('a holder that loses its lease with a sub-agent call in flight', () => {
  it('closes the sub-agent tool span as handoff, because the next host takes the call over', async () => {
    const trace = new RecordingTracer()
    const rig = await makeRig({
      plugins: composePlugins([probePlugin()]),
      model: splitModel(PARENT_SCRIPT, CHILD_SCRIPT),
      trace,
    })
    await seedSession(rig)
    await rig.holder.start()

    await rig.post('spawn one')
    await rig.wake()
    const spawned = await flushUntil({
      check: async () =>
        (await eventsIn({ rig, threadId: THREAD_ID })).some((e) => e.type === 'agent-spawned'),
      clock: rig.clock,
    })
    expect(spawned).toBe(true)
    const childId = childIdOf(await eventsIn({ rig, threadId: THREAD_ID }))
    const dispatched = await flushUntil({
      check: async () =>
        (await eventsIn({ rig, threadId: childId })).some((e) => e.type === 'tool-dispatched'),
      clock: rig.clock,
      attempts: 3000,
      advanceMs: 1_000,
    })
    expect(dispatched).toBe(true)
    const inFlight = trace.named(ESpan.Tool).find((span) => span.fields.callId === 'child-bash')
    expect(inFlight).toBeDefined()

    rig.presence.lose()

    const closed = await flushUntil({
      check: async () => inFlight?.ended === true,
      clock: rig.clock,
      attempts: 3000,
      advanceMs: 1_000,
    })
    expect(closed).toBe(true)
    expect(inFlight?.fields.outcome).toBe(ESpanOutcome.Handoff)

    const childEvents = await eventsIn({ rig, threadId: childId })
    expect(childEvents.map((event) => event.type)).toEqual([
      'input-posted',
      'user-said',
      'tool-called',
      'tool-dispatched',
    ])
  }, 20_000)
})
