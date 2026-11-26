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
import { z } from 'zod'

import { flushUntil, makeRig, seedSession, SESSION, THREAD_ID } from './holder-rig'

const CHILD_BRIEF = 'CHILD-BRIEF wait in the pod'
const SPAWN_PROBE = 'crew_spawn_probe'

type Spawned = { agentId: string | undefined }

class SpawnProbe extends ToolDefinition {
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

const probePlugin = (spawned: Spawned): Plugin =>
  definePlugin({
    name: 'crew-drain-probe',
    events: [],
    views: [],
    commands: [],
    pod: {
      childDeny: [SPAWN_PROBE],
      tools: (ctx) => [new SpawnProbe(ctx, spawned)],
      prompts: [],
    },
    control: { hooks: [], commands: new Map() },
    client: { hooks: [] },
    transport: 'none',
  })

const splitModel = (scripts: {
  parent: readonly ScriptedModelStep[]
  child: readonly ScriptedModelStep[]
}): ModelPort => {
  const parent = new ScriptedModel(scripts.parent)
  const child = new ScriptedModel(scripts.child)
  return {
    identity: parent.identity,
    step: async (args) => {
      const request = { ...args }
      return JSON.stringify(request.assembled).includes(CHILD_BRIEF)
        ? child.step(args)
        : parent.step(args)
    },
  }
}

const crewRig = async () => {
  const spawned: Spawned = { agentId: undefined }
  const model = splitModel({
    parent: [{ calls: [{ callId: 'c1', name: SPAWN_PROBE, input: {} }] }, { text: 'parent done' }],
    child: [
      { calls: [{ callId: 'b1', name: 'bash', input: { command: 'sleep 30' } }] },
      { text: 'child done' },
    ],
  })
  const rig = await makeRig({ plugins: composePlugins([probePlugin(spawned)]), model: () => model })
  await seedSession(rig)
  await rig.holder.start()
  return rig
}

const eventsIn = async (
  rig: Awaited<ReturnType<typeof crewRig>>,
  threadId: string,
): Promise<RecordEvent[]> =>
  (await rig.plane.readEvents({ threadId, afterSeq: 0, limit: 500, visible: false })).events

const childIdOf = (events: readonly RecordEvent[]): string => {
  const spawned = events.find((event) => event.type === 'agent-spawned')
  if (spawned === undefined || spawned.type !== 'agent-spawned') throw new Error('no spawn')
  return spawned.agentId
}

describe('draining while a sub-agent waits on the pod', () => {
  it('hands the session back without waiting for the child turn', async () => {
    const rig = await crewRig()
    await rig.post('spawn one')
    await rig.wake()

    const dispatched = await flushUntil({
      check: async () => {
        const parent = await eventsIn(rig, THREAD_ID)
        const spawned = parent.find((event) => event.type === 'agent-spawned')
        if (spawned === undefined) return false
        const child = await eventsIn(rig, childIdOf(parent))
        return child.some((event) => event.type === 'tool-dispatched')
      },
      attempts: 200,
      clock: rig.clock,
    })
    expect(dispatched).toBe(true)
    expect(rig.runCount()).toBe(1)

    let drained = false
    void rig.holder.drain().then(() => {
      drained = true
    })
    expect(await flushUntil({ check: () => drained, attempts: 200, clock: rig.clock })).toBe(true)

    const { lease } = await rig.plane.currentLease({ sessionId: SESSION })
    expect(lease.holderHostId).toBeNull()
  }, 20_000)
})
