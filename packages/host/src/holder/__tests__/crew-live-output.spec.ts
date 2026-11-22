import { describe, expect, it } from 'bun:test'

import {
  EStepEndReason,
  EToolEffect,
  ToolDefinition,
  type ModelPort,
  type ToolOutcome,
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

const CHILD_BRIEF = 'LIVE-BRIEF stream the answer'
const CHILD_ANSWER = 'the child answer streams in pieces'
const SPAWN_PROBE = 'live_spawn_probe'

type Spawned = { agentId: string | undefined }

class SpawnProbe extends ToolDefinition {
  readonly name: string = SPAWN_PROBE
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
      intent: 'live',
      prompt: CHILD_BRIEF,
    })
    this.spawned.agentId = snapshot.agentId
    return { ok: true, output: { agentId: snapshot.agentId }, modelText: 'spawned' }
  }
}

const spawnPlugin = (spawned: Spawned): Plugin =>
  definePlugin({
    name: 'live-spawn-probe',
    events: [],
    views: [],
    commands: [],
    pod: {
      childDeny: [SPAWN_PROBE],
      tools: (ctx) => [new SpawnProbe(ctx, spawned)],
      prompts: [],
      commands: new Map(),
    },
    control: { hooks: [], commands: new Map() },
    client: { hooks: [] },
    transport: 'none',
  })

const splitModel = (scripts: {
  parent: readonly ScriptedModelStep[]
  child: readonly ScriptedModelStep[]
}): ModelPort & { parent: ScriptedModel; child: ScriptedModel } => {
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

const childIdOf = async (rig: Awaited<ReturnType<typeof makeRig>>): Promise<string> => {
  const page = await rig.plane.readEvents({
    threadId: THREAD_ID,
    afterSeq: 0,
    limit: 500,
    visible: false,
  })
  const spawned = page.events.find((event) => event.type === 'agent-spawned')
  if (spawned === undefined || spawned.type !== 'agent-spawned') throw new Error('no spawn')
  return spawned.agentId
}

describe('a sub-agent live output', () => {
  it('publishes its step frames under its own thread id', async () => {
    const spawned: Spawned = { agentId: undefined }
    const model = splitModel({
      parent: [
        { calls: [{ callId: 'c1', name: SPAWN_PROBE, input: {} }] },
        { text: 'parent done' },
      ],
      child: [{ text: CHILD_ANSWER, streamMs: 40 }],
    })
    const rig = await makeRig({
      plugins: composePlugins([spawnPlugin(spawned)]),
      model: () => model,
    })
    await seedSession(rig)
    await rig.holder.start()

    await rig.post('spawn one')
    await rig.wake()

    const landed = await flushUntil({
      check: async () =>
        rig.bus.frames.some(
          (entry) => entry.key === spawned.agentId && entry.frame.type === 'step-end',
        ),
      clock: rig.clock,
    })
    expect(landed).toBe(true)

    const childId = await childIdOf(rig)
    expect(spawned.agentId).toBe(childId)
    const childFrames = rig.bus.frames
      .filter((entry) => entry.key === childId)
      .map((entry) => entry.frame)
    const stepFrames = childFrames.filter((frame) =>
      ['step-start', 'delta', 'step-end'].includes(frame.type),
    )
    expect(stepFrames[0]?.type).toBe('step-start')
    expect(stepFrames.at(-1)).toMatchObject({
      type: 'step-end',
      reason: EStepEndReason.Finished,
    })

    const text = childFrames.flatMap((frame) => (frame.type === 'delta' ? [frame.text] : []))
    expect(text.join('')).toBe(CHILD_ANSWER)

    const onMain = rig.bus.frames
      .filter((entry) => entry.key !== childId)
      .flatMap((entry) => (entry.frame.type === 'delta' ? [entry.frame.text] : []))
    expect(onMain.join('')).not.toContain(CHILD_ANSWER)
  })
})
