import { describe, expect, it } from 'bun:test'

import {
  EShellStatus,
  EToolEffect,
  ToolDefinition,
  type ModelPort,
  type ToolOutcome,
  type RecordEvent,
} from '@dltech/atlas-core'
import { ControlPlane } from '@dltech/atlas-control'
import { InMemoryControlStore } from '@dltech/atlas-control/testing'
import {
  composePlugins,
  definePlugin,
  type Plugin,
  type PluginPodContext,
} from '@dltech/atlas-plugin-sdk'
import { ScriptedModel } from '@dltech/atlas-agent/testing'
import { z } from 'zod'

import { flushUntil, makeRig, seedSession, SESSION, THREAD_ID } from './holder-rig'

const CHILD_BRIEF = 'SETTLE-BRIEF take the first pass'
const GRAB_PROBE = 'settle_grab_probe'
const SPAWN_PROBE = 'settle_spawn_probe'
const SHELL_ID = 'bash_settle_1'
const SHELL_ID_2 = 'bash_settle_2'

type NoticeState = { child: PluginPodContext | undefined }

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
      intent: 'settle',
      prompt: CHILD_BRIEF,
    })
    return { ok: true, output: { agentId: snapshot.agentId }, modelText: 'spawned' }
  }
}

class GrabProbe extends ToolDefinition {
  readonly name: string = GRAB_PROBE
  readonly description = 'keep the pod context this sub-agent runs with'
  readonly effect = EToolEffect.Read
  readonly inputSchema = z.object({})

  constructor(
    private readonly ctx: PluginPodContext,
    private readonly state: NoticeState,
  ) {
    super()
  }

  async invoke(): Promise<ToolOutcome> {
    this.state.child = this.ctx
    return { ok: true, output: {}, modelText: 'kept' }
  }
}

const noticeProbePlugin = (state: NoticeState): Plugin =>
  definePlugin({
    name: 'settle-probe',
    events: [],
    views: [],
    commands: [],
    pod: {
      childDeny: [SPAWN_PROBE],
      tools: (ctx) => [new SpawnProbe(ctx), new GrabProbe(ctx, state)],
      prompts: [],
    },
    control: { hooks: [], commands: new Map() },
    client: { hooks: [] },
    transport: 'none',
  })

const shellEnding = (shellId: string) => ({
  type: 'background-shell-ended' as const,
  shellId,
  command: 'bun test --watch',
  status: EShellStatus.Exited,
  exitCode: 0,
  output: 'all green',
  droppedCharacters: 0,
  remainingCharacters: 0,
})

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

const childIdOf = (events: readonly RecordEvent[]): string | undefined =>
  events.flatMap((event) => (event.type === 'agent-spawned' ? [event.agentId] : []))[0]

const saidTexts = (events: readonly RecordEvent[]): string[] =>
  events.flatMap((event) =>
    event.type === 'assistant-said'
      ? event.parts.flatMap((part) => (part.type === 'text' ? [part.text] : []))
      : [],
  )

const endingKeys = async (rig: Awaited<ReturnType<typeof makeRig>>): Promise<string[]> =>
  (await rig.plane.readInbox({ sessionId: SESSION, afterId: 0, limit: 200 })).flatMap((entry) => {
    if (entry.kind !== 'event' || !entry.payload.includes('"agent-ended"')) return []
    const key: unknown = JSON.parse(entry.payload).clientId
    return typeof key === 'string' ? [key] : []
  })

type Harness = {
  rig: Awaited<ReturnType<typeof makeRig>>
  state: NoticeState
  child: ScriptedModel
  childId: string
}

const spawnChild = async (args: {
  child: ScriptedModel
  awaitEnding?: boolean | undefined
  wrapPlane?: ((plane: ControlPlane) => ControlPlane) | undefined
}): Promise<Harness> => {
  const state: NoticeState = { child: undefined }
  const parent = new ScriptedModel([
    { calls: [{ callId: 'c1', name: SPAWN_PROBE, input: {} }] },
    { text: 'parent busy' },
    { text: 'parent idle' },
    { text: 'parent idle' },
    { text: 'parent idle' },
  ])
  const model: ModelPort = {
    identity: parent.identity,
    step: async (stepArgs) =>
      JSON.stringify(stepArgs.assembled).includes(CHILD_BRIEF)
        ? args.child.step(stepArgs)
        : parent.step(stepArgs),
  }
  const store = new InMemoryControlStore({ clock: () => new Date(0).toISOString() })
  const plane = new ControlPlane({ store })
  const rig = await makeRig({
    store,
    plane: args.wrapPlane?.(plane) ?? plane,
    plugins: composePlugins([noticeProbePlugin(state)]),
    model: () => model,
  })

  await seedSession(rig)
  await rig.holder.start()
  await rig.post('spawn one')
  await rig.wake()
  await flushUntil({
    check: async () => {
      const childId = childIdOf(await eventsIn(rig, THREAD_ID))
      return childId !== undefined && saidTexts(await eventsIn(rig, childId)).length === 1
    },
    clock: rig.clock,
    attempts: 400,
  })
  const childId = childIdOf(await eventsIn(rig, THREAD_ID))
  if (childId === undefined) throw new Error('no spawn')
  if (args.awaitEnding !== false) {
    const settled = await flushUntil({
      check: async () => (await endingKeys(rig)).length > 0,
      clock: rig.clock,
      attempts: 400,
    })
    if (!settled) throw new Error('the sub-agent never ended')
  }
  await rig.flush()
  if (state.child === undefined) throw new Error('the sub-agent never ran a tool')
  return { rig, state, child: args.child, childId }
}

describe('an idle sub-agent given a notice', () => {
  it('answers it and reports a second ending of its own', async () => {
    const harness = await spawnChild({
      child: new ScriptedModel([
        { calls: [{ callId: 'n1', name: GRAB_PROBE, input: {} }] },
        { text: 'child answer' },
        { text: 'saw the shell ending' },
      ]),
    })
    expect(await endingKeys(harness.rig)).toHaveLength(1)
    await harness.state.child?.notify(shellEnding(SHELL_ID), { key: `shell:${SHELL_ID}` })
    const second = await flushUntil({
      check: async () => (await endingKeys(harness.rig)).length === 2,
      clock: harness.rig.clock,
      attempts: 400,
    })
    expect(second).toBe(true)
    const keys = await endingKeys(harness.rig)
    expect(new Set(keys).size).toBe(2)
    expect(keys.every((key) => key.startsWith(`agent-ended:${harness.childId}:`))).toBe(true)
    expect(saidTexts(await eventsIn(harness.rig, harness.childId))).toEqual([
      'child answer',
      'saw the shell ending',
    ])
  }, 30_000)

  it('answers both notices with one turn when two arrive together', async () => {
    const harness = await spawnChild({
      child: new ScriptedModel([
        { calls: [{ callId: 'n1', name: GRAB_PROBE, input: {} }] },
        { text: 'child answer' },
        { text: 'saw both notices' },
        { text: 'saw the leftover notice' },
      ]),
    })
    const childCtx = harness.state.child
    if (childCtx === undefined) throw new Error('the sub-agent never ran a tool')

    await Promise.all([
      childCtx.notify(shellEnding(SHELL_ID), { key: `shell:${SHELL_ID}` }),
      childCtx.notify(shellEnding(SHELL_ID_2), { key: `shell:${SHELL_ID_2}` }),
    ])
    const answered = await flushUntil({
      check: async () => saidTexts(await eventsIn(harness.rig, harness.childId)).length === 2,
      clock: harness.rig.clock,
      attempts: 400,
    })
    expect(answered).toBe(true)
    expect(saidTexts(await eventsIn(harness.rig, harness.childId))).toEqual([
      'child answer',
      'saw both notices',
    ])
    const assembled = JSON.stringify(harness.child.requests.at(-1)?.assembled)
    expect(assembled).toContain(SHELL_ID)
    expect(assembled).toContain(SHELL_ID_2)
  }, 30_000)

  it('drains a notice that arrives while the ending is being posted', async () => {
    let release: () => void = () => undefined
    let reached: () => void = () => undefined
    const gated = new Promise<void>((resolve) => {
      release = resolve
    })
    const arrived = new Promise<void>((resolve) => {
      reached = resolve
    })
    const wrapPlane = (plane: ControlPlane): ControlPlane =>
      new Proxy(plane, {
        get: (target, prop, receiver) => {
          const value = Reflect.get(target, prop, receiver)
          if (prop !== 'post' || typeof value !== 'function') {
            return typeof value === 'function' ? value.bind(target) : value
          }
          return async (message: { kind: string; payload: string }) => {
            if (message.kind === 'event' && message.payload.includes('"agent-ended"')) {
              reached()
              await gated
            }
            return value.call(target, message)
          }
        },
      })

    const harness = await spawnChild({
      child: new ScriptedModel([
        { calls: [{ callId: 'n1', name: GRAB_PROBE, input: {} }] },
        { text: 'child answer' },
        { text: 'saw the waiting notice' },
      ]),
      wrapPlane,
      awaitEnding: false,
    })
    await arrived
    const childCtx = harness.state.child
    if (childCtx === undefined) throw new Error('the sub-agent never ran a tool')
    await childCtx.notify(shellEnding(SHELL_ID), { key: `shell:${SHELL_ID}` })
    expect(saidTexts(await eventsIn(harness.rig, harness.childId))).toEqual(['child answer'])
    release()
    const drained = await flushUntil({
      check: async () => saidTexts(await eventsIn(harness.rig, harness.childId)).length === 2,
      clock: harness.rig.clock,
      attempts: 400,
    })
    expect(drained).toBe(true)
    expect(JSON.stringify(harness.child.requests.at(-1)?.assembled)).toContain(SHELL_ID)
  }, 30_000)
})
