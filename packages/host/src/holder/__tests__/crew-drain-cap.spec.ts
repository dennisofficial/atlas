import { describe, expect, it } from 'bun:test'

import {
  EFinishReason,
  EToolEffect,
  ModelPort,
  ToolDefinition,
  type ModelStepResult,
  type RecordEvent,
  type ToolOutcome,
} from '@dltech/atlas-core'
import {
  composePlugins,
  definePlugin,
  type Plugin,
  type PluginPodContext,
} from '@dltech/atlas-plugin-sdk'
import { FakeTool, ScriptedModel, type ScriptedModelStep } from '@dltech/atlas-agent/testing'
import { LogPort } from '@dltech/atlas-observability'
import { z } from 'zod'

import { DRAIN_IN_FLIGHT_CAP_MS, DRAIN_STREAM_ABORT_CAP_MS } from '../drain-cap'
import { flushUntil, makeRig, seedSession, SESSION, THREAD_ID } from './holder-rig'

const CHILD_BRIEF = 'CHILD-BRIEF wait in the pod'
const PARTIAL_TEXT = 'child partial'
const SPAWN_PROBE = 'crew_drain_spawn'

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
      intent: 'drain',
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

const PARENT_SCRIPT: readonly ScriptedModelStep[] = [
  { calls: [{ callId: 'p1', name: SPAWN_PROBE, input: {} }] },
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

const childPartial = (): ModelStepResult => ({
  parts: [{ type: 'text', text: PARTIAL_TEXT }],
  toolCalls: [],
  finishReason: EFinishReason.Stop,
})

class PartialOnAbortModel extends ModelPort {
  readonly identity = { id: 'child-partial', modelId: 'child-partial-1' }
  started = 0

  step: ModelPort['step'] = (args: { signal: AbortSignal }) => {
    this.started += 1
    return new Promise<ModelStepResult>((resolve) => {
      args.signal.addEventListener('abort', () => resolve(childPartial()))
    })
  }
}

class GatedTool extends FakeTool {
  started = false
  private release: (() => void) | undefined

  constructor() {
    super('slow', 'done', undefined, EToolEffect.Write)
  }

  releaseNow(): void {
    this.release?.()
  }

  override async invoke(): Promise<ToolOutcome> {
    this.started = true
    await new Promise<void>((resolve) => {
      this.release = resolve
    })
    return { ok: true, output: 'done', modelText: 'done' }
  }
}

class MemoryLog extends LogPort {
  readonly entries: { source: unknown; message: string }[] = []
  record(entry: Parameters<LogPort['record']>[0]): void {
    this.entries.push({ source: entry.source, message: entry.message })
  }
}

type Rig = Awaited<ReturnType<typeof makeRig>>

const eventsIn = async (args: { rig: Rig; threadId: string }): Promise<RecordEvent[]> =>
  (
    await args.rig.plane.readEvents({
      threadId: args.threadId as typeof THREAD_ID,
      afterSeq: 0,
      limit: 1_000,
      visible: false,
    })
  ).events

const childIdOf = (events: readonly RecordEvent[]): string => {
  const spawned = events.find((event) => event.type === 'agent-spawned')
  if (spawned === undefined || spawned.type !== 'agent-spawned') throw new Error('no spawn')
  return spawned.agentId
}

const spawnedChild = async (rig: Rig): Promise<string> => {
  const spawned = await flushUntil({
    check: async () =>
      (await eventsIn({ rig, threadId: THREAD_ID })).some(
        (event) => event.type === 'agent-spawned',
      ),
    clock: rig.clock,
  })
  expect(spawned).toBe(true)
  return childIdOf(await eventsIn({ rig, threadId: THREAD_ID }))
}

const repliesOf = (events: readonly RecordEvent[]) =>
  events.flatMap((event) =>
    event.type === 'assistant-said'
      ? [
          {
            text: event.parts.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join(''),
            interrupted: event.interrupted,
            aborted: event.aborted,
          },
        ]
      : [],
  )

const ofType = (args: { events: readonly RecordEvent[]; type: string }): RecordEvent[] =>
  args.events.filter((event) => event.type === args.type)

const drainPastCap = async (rig: Rig): Promise<void> => {
  let drained = false
  const draining = rig.holder.drain().then(() => {
    drained = true
  })
  await rig.flush()
  expect(drained).toBe(false)
  rig.clock.advance(DRAIN_IN_FLIGHT_CAP_MS)
  await rig.flush()
  rig.clock.advance(DRAIN_STREAM_ABORT_CAP_MS)
  await draining
}

describe('draining while a sub-agent works', () => {
  it('hands back at once while a child host tool still runs', async () => {
    const spawned: Spawned = { agentId: undefined }
    const tool = new GatedTool()
    const log = new MemoryLog()
    const a = await makeRig({
      plugins: composePlugins([probePlugin(spawned)]),
      hostTools: [tool],
      log,
      model: () =>
        splitModel({
          parent: new ScriptedModel(PARENT_SCRIPT),
          child: new ScriptedModel([
            { calls: [{ callId: 'ct1', name: 'slow', input: {} }] },
            { text: 'child done' },
          ]),
        }),
    })
    await seedSession(a)
    await a.holder.start()
    await a.post('spawn one')
    await a.wake()
    const childId = await spawnedChild(a)
    expect(await flushUntil({ check: () => tool.started, clock: a.clock })).toBe(true)

    let drained = false
    void a.holder.drain().then(() => {
      drained = true
    })
    expect(await flushUntil({ check: () => drained })).toBe(true)

    const child = await eventsIn({ rig: a, threadId: childId })
    expect(ofType({ events: child, type: 'tool-result' })).toEqual([])
    expect(ofType({ events: child, type: 'nudge' })).toEqual([])
    const caps = log.entries.filter((entry) => entry.source === 'holder.drain')
    expect(caps.map((entry) => entry.message).join('\n')).not.toContain('past the drain cap')
    const { lease } = await a.plane.currentLease({ sessionId: SESSION })
    expect(lease.holderHostId).toBeNull()
    tool.releaseNow()
    await a.flush()
  }, 20_000)

  it('records a child stream cut at the cap as a handoff reply, and the next holder asks again', async () => {
    const spawned: Spawned = { agentId: undefined }
    const childModel = new PartialOnAbortModel()
    const plugins = (): ReturnType<typeof composePlugins> => composePlugins([probePlugin(spawned)])
    const a = await makeRig({
      plugins: plugins(),
      model: () => splitModel({ parent: new ScriptedModel(PARENT_SCRIPT), child: childModel }),
    })
    await seedSession(a)
    await a.holder.start()
    await a.post('spawn one')
    await a.wake()
    const childId = await spawnedChild(a)
    expect(await flushUntil({ check: () => childModel.started > 0, clock: a.clock })).toBe(true)

    await drainPastCap(a)

    const drained = await eventsIn({ rig: a, threadId: childId })
    expect(repliesOf(drained)).toEqual([
      { text: PARTIAL_TEXT, interrupted: true, aborted: 'handoff' },
    ])
    expect(ofType({ events: drained, type: 'nudge' })).toEqual([])

    const childAnswer = new ScriptedModel([{ text: 'child answered' }])
    const b = await makeRig({
      plane: a.plane,
      store: a.store,
      bus: a.bus,
      clock: a.clock,
      daemon: a.daemon,
      plugins: plugins(),
      model: () =>
        splitModel({
          parent: new ScriptedModel([{ text: 'parent saw the child' }]),
          child: childAnswer,
        }),
    })
    await b.holder.start()
    await a.bus.wake(SESSION)

    const asked = await flushUntil({
      check: () => childAnswer.requests.length > 0,
      clock: a.clock,
      advanceMs: 5_000,
    })
    expect(asked).toBe(true)
    const prompt = JSON.stringify(childAnswer.requests[0]?.assembled)
    expect(prompt).not.toContain(PARTIAL_TEXT)
    expect(prompt).not.toContain('You were interrupted mid-turn')

    const resumed = await flushUntil({
      check: async () => repliesOf(await eventsIn({ rig: a, threadId: childId })).length === 2,
      clock: a.clock,
      advanceMs: 5_000,
    })
    expect(resumed).toBe(true)
    const after = await eventsIn({ rig: a, threadId: childId })
    expect(repliesOf(after)).toEqual([
      { text: PARTIAL_TEXT, interrupted: true, aborted: 'handoff' },
      { text: 'child answered', interrupted: undefined, aborted: undefined },
    ])
    expect(ofType({ events: after, type: 'nudge' })).toEqual([])
  }, 25_000)
})
