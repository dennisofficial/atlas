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
} from '@dltech/atlas-plugin-sdk'
import { ScriptedModel, type ScriptedModelStep } from '@dltech/atlas-agent/testing'
import { z } from 'zod'

import { flushUntil, makeRig, seedSession, SESSION, THREAD_ID } from './holder-rig'

const CHILD_BRIEF = 'TAKEOVER-BRIEF take the long way'
const CHILD_ANSWER = 'TAKEOVER-CHILD done'
const SPAWN_PROBE = 'takeover_spawn_probe'

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

const probePlugin = (state: ProbeState): Plugin =>
  definePlugin({
    name: 'takeover-probe',
    events: [],
    views: [],
    commands: [],
    pod: {
      childDeny: [SPAWN_PROBE],
      tools: (ctx) => [new SpawnProbe(ctx, state)],
      prompts: [],
      commands: new Map(),
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

const endingsOf = (events: readonly V2Event[], agentId: string): V2Event[] =>
  events.filter((event) => event.type === 'agent-ended' && event.agentId === agentId)

describe('a host handoff while a sub-agent runs', () => {
  it('leaves the child unended on drain and the next holder resumes its turn', async () => {
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
      check: async () => (await eventsIn(a, THREAD_ID)).some((e) => e.type === 'agent-spawned'),
      clock: a.clock,
    })
    expect(spawned).toBe(true)
    const childId = childIdOf(await eventsIn(a, THREAD_ID))
    const stepping = await flushUntil({
      check: async () => (await eventsIn(a, childId)).length > 0,
      clock: a.clock,
    })
    expect(stepping).toBe(true)

    const before = Date.now()
    await a.holder.drain()
    expect(Date.now() - before).toBeLessThan(2_000)

    const drained = await eventsIn(a, THREAD_ID)
    expect(endingsOf(drained, childId)).toEqual([])
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

    const resumed = await flushUntil({
      check: async () =>
        (await eventsIn(a, THREAD_ID)).some(
          (event) => event.type === 'agent-ended' && event.agentId === childId,
        ),
      attempts: 200,
      clock: a.clock,
      advanceMs: 5_000,
    })
    expect(resumed).toBe(true)

    const parent = await eventsIn(a, THREAD_ID)
    expect(endingsOf(parent, childId)).toMatchObject([{ status: 'finished', prose: CHILD_ANSWER }])
    expect(endingsOf(parent, childId)[0]).not.toMatchObject({ killedBy: 'unrecorded' })
    expect(parent.filter((event) => event.type === 'agent-restarted')).toMatchObject([
      { agentId: childId, via: 'relocation' },
    ])
    expect((await eventsIn(a, childId)).filter((event) => event.type === 'agent-ended')).toEqual([])
  }, 20_000)
})
