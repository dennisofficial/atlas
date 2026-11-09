import { describe, expect, it } from 'bun:test'

import {
  EToolEffect,
  ToolDefinition,
  type ModelPort,
  type ToolDeclaration,
  type ToolOutcome,
  type V2Event,
} from '@dltech/atlas-core'
import {
  composePlugins,
  definePlugin,
  type Plugin,
  type PluginPodContext,
} from '@dltech/atlas-plugin-sdk'
import {
  ScriptedModel,
  type ModelRequest,
  type ScriptedModelStep,
} from '@dltech/atlas-agent/testing'
import { z } from 'zod'

import { flushUntil, makeRig, seedSession, SESSION, THREAD_ID } from './holder-rig'

const CHILD_BRIEF = 'CHILD-BRIEF read the thing'
const SPAWN_PROBE = 'crew_spawn_probe'

type Spawned = { agentId: string | undefined }

class CrewSpawnProbe extends ToolDefinition {
  readonly name = SPAWN_PROBE
  readonly description = 'spawn a sub-agent through the crew port'
  readonly effect = EToolEffect.Write
  readonly inputSchema = z.object({})

  constructor(
    private readonly ctx: PluginPodContext,
    private readonly spawned: Spawned,
  ) {
    super()
  }

  async invoke(): Promise<ToolOutcome> {
    const snapshot = await this.ctx.crew.spawn({
      agentType: 'general-purpose',
      intent: 'probe',
      prompt: CHILD_BRIEF,
    })
    this.spawned.agentId = snapshot.agentId
    return {
      ok: true,
      output: { agentId: snapshot.agentId },
      modelText: `spawned ${snapshot.agentId}`,
    }
  }
}

const crewProbePlugin = (spawned: Spawned): Plugin =>
  definePlugin({
    name: 'crew-probe',
    events: [],
    views: [],
    commands: [],
    pod: {
      childDeny: [SPAWN_PROBE],
      tools: (ctx) => [new CrewSpawnProbe(ctx, spawned)],
      prompts: [],
      commands: new Map(),
    },
    control: { hooks: [], commands: new Map() },
    client: { hooks: [] },
    transport: 'none',
  })

type SplitModel = ModelPort & { parent: ScriptedModel; child: ScriptedModel }

const splitModel = (scripts: {
  parent: readonly ScriptedModelStep[]
  child: readonly ScriptedModelStep[]
}): SplitModel => {
  const parent = new ScriptedModel(scripts.parent)
  const child = new ScriptedModel(scripts.child)
  return {
    identity: parent.identity,
    step: async ({ assembled, tools, signal, onChunk }) => {
      const args = { assembled, tools, signal, ...(onChunk === undefined ? {} : { onChunk }) }
      return JSON.stringify(assembled).includes(CHILD_BRIEF) ? child.step(args) : parent.step(args)
    },
    parent,
    child,
  }
}

const eventsIn = async (
  rig: Awaited<ReturnType<typeof makeRig>>,
  threadId: typeof THREAD_ID,
): Promise<V2Event[]> =>
  (await rig.plane.readEvents({ threadId, afterSeq: 0, limit: 500, visible: false })).events

const crewRig = async () => {
  const spawned: Spawned = { agentId: undefined }
  const composed = composePlugins([crewProbePlugin(spawned)])
  const model = splitModel({
    parent: [
      { calls: [{ callId: 'c1', name: SPAWN_PROBE, input: {} }] },
      { text: 'parent done' },
      { text: 'saw the report' },
    ],
    child: [{ text: 'child answer' }],
  })
  const rig = await makeRig({ plugins: composed, model: () => model })
  await seedSession(rig)
  await rig.holder.start()
  return { rig, model, spawned }
}

const childIdOf = (events: readonly V2Event[]): string => {
  const spawned = events.find((event) => event.type === 'agent-spawned')
  if (spawned === undefined || spawned.type !== 'agent-spawned') throw new Error('no spawn')
  return spawned.agentId
}

const toolNamesOf = (request: ModelRequest | undefined): readonly string[] =>
  request === undefined ? [] : request.tools.map((tool: ToolDeclaration) => tool.name)

describe('a sub-agent spawned with the crew port', () => {
  it('runs on its own thread, reports to the parent and is denied the tools it may not use', async () => {
    const { rig, model } = await crewRig()

    await rig.post('spawn one')
    await rig.wake()

    const landed = await flushUntil({
      check: async () =>
        (await eventsIn(rig, THREAD_ID)).some((event) => event.type === 'agent-ended'),
      clock: rig.clock,
    })
    expect(landed).toBe(true)

    const parentEvents = await eventsIn(rig, THREAD_ID)
    const childId = childIdOf(parentEvents)
    expect(parentEvents.filter((event) => event.type === 'agent-spawned')).toMatchObject([
      { agentType: 'general-purpose', intent: 'probe' },
    ])
    expect(parentEvents.filter((event) => event.type === 'agent-ended')).toMatchObject([
      { agentId: childId, status: 'finished', turns: 1, prose: 'child answer' },
    ])
    expect(parentEvents.filter((event) => event.type === 'agent-reported')).toMatchObject([
      { agentId: childId, kind: 'done', prose: 'child answer' },
    ])

    const childEvents = await eventsIn(rig, childId as typeof THREAD_ID)
    expect(childEvents.filter((event) => event.type === 'user-said')).toMatchObject([
      { text: CHILD_BRIEF },
    ])
    expect(childEvents.filter((event) => event.type === 'assistant-said')).toMatchObject([
      { parts: [{ type: 'text', text: 'child answer' }] },
    ])

    expect(toolNamesOf(model.parent.requests[0])).toContain(SPAWN_PROBE)
    expect(toolNamesOf(model.child.requests[0])).not.toContain(SPAWN_PROBE)

    await rig.wake()
    await flushUntil({
      check: async () =>
        (await eventsIn(rig, THREAD_ID)).some(
          (event) => event.type === 'user-said' && event.text.includes(`Sub-agent ${childId}`),
        ),
      clock: rig.clock,
    })
    const afterReport = await eventsIn(rig, THREAD_ID)
    expect(
      afterReport.some(
        (event) => event.type === 'user-said' && event.text.includes(`Sub-agent ${childId}`),
      ),
    ).toBe(true)
    expect((await rig.plane.readSession({ sessionId: SESSION }))?.mainThreadId).toBe(THREAD_ID)
  })
})
