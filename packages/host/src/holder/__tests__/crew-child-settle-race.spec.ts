import { describe, expect, it } from 'bun:test'

import { ControlPlane } from '@dltech/atlas-control'
import { InMemoryControlStore } from '@dltech/atlas-control/testing'
import {
  EToolEffect,
  ToolDefinition,
  toThreadId,
  type ModelPort,
  type ThreadId,
  type ToolOutcome,
  type V2Event,
} from '@dltech/atlas-core'
import { INBOX_KIND_MESSAGE } from '@dltech/atlas-protocol'
import {
  composePlugins,
  definePlugin,
  type Plugin,
  type PluginPodContext,
} from '@dltech/atlas-plugin-sdk'
import { ScriptedModel } from '@dltech/atlas-agent/testing'
import { z } from 'zod'

import { messagePayloadOf } from '../crew/child-reports'
import { FakeClock, flushUntil, makeRig, seedSession, SESSION, THREAD_ID } from './holder-rig'

const CHILD_BRIEF = 'SETTLE-BRIEF take the first pass'
const CHILD_ANSWER = 'SETTLE-CHILD first answer'
const LATE = 'SETTLE-LATE one more thing'
const CHILD_LATE_ANSWER = 'SETTLE-CHILD answered the late message'
const SPAWN_PROBE = 'settle_spawn_probe'

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
      intent: 'settle',
      prompt: CHILD_BRIEF,
    })
    this.state.agentId = snapshot.agentId
    return { ok: true, output: { agentId: snapshot.agentId }, modelText: 'spawned' }
  }
}

const spawnProbePlugin = (state: ProbeState): Plugin =>
  definePlugin({
    name: 'settle-probe',
    events: [],
    views: [],
    commands: [],
    pod: {
      childDeny: [SPAWN_PROBE],
      tools: (ctx) => [new SpawnProbe(ctx, state)],
      prompts: [],
    },
    control: { hooks: [], commands: new Map() },
    client: { hooks: [] },
    transport: 'none',
  })

const eventsIn = async (args: { plane: ControlPlane; threadId: ThreadId }): Promise<V2Event[]> => {
  const events: V2Event[] = []
  let afterSeq = 0
  for (;;) {
    const page = await args.plane.readEvents({
      threadId: args.threadId,
      afterSeq,
      limit: 1000,
      visible: false,
    })
    events.push(...page.events)
    if (page.next === undefined) return events
    afterSeq = page.next
  }
}

const spawnedChildOf = async (plane: ControlPlane): Promise<ThreadId | undefined> => {
  const spawned = (await eventsIn({ plane, threadId: THREAD_ID })).find(
    (event) => event.type === 'agent-spawned',
  )
  return spawned?.type === 'agent-spawned' ? toThreadId(spawned.agentId) : undefined
}

const answeredOn = async (args: { plane: ControlPlane; threadId: ThreadId }): Promise<number> =>
  (await eventsIn(args)).filter((event) => event.type === 'assistant-said').length

const userSaidOn = async (args: { plane: ControlPlane; threadId: ThreadId }): Promise<string[]> =>
  (await eventsIn(args)).flatMap((event) => (event.type === 'user-said' ? [event.text] : []))

describe('a message posted while the child checks for more work', () => {
  it('reaches the child instead of ending the pump', async () => {
    const state: ProbeState = { agentId: undefined }
    const clock = new FakeClock()
    const store = new InMemoryControlStore({ clock: () => new Date(clock.now()).toISOString() })
    const base = new ControlPlane({ store })
    let armed = false
    let gateUsed = false
    let release: () => void = () => undefined
    const gated = new Promise<void>((resolve) => {
      release = resolve
    })
    const plane = new Proxy(base, {
      get: (target, property) => {
        const value = Reflect.get(target, property)
        if (property !== 'readInbox') {
          return typeof value === 'function' ? value.bind(target) : value
        }
        return async (read: Parameters<ControlPlane['readInbox']>[0]) => {
          const childId = await spawnedChildOf(target)
          if (
            armed &&
            !gateUsed &&
            childId !== undefined &&
            read.forThread === childId &&
            (await answeredOn({ plane: target, threadId: childId })) > 0
          ) {
            gateUsed = true
            await gated
          }
          return target.readInbox(read)
        }
      },
    })
    const parent = new ScriptedModel([
      { calls: [{ callId: 'c1', name: SPAWN_PROBE, input: {} }] },
      { text: 'parent done' },
    ])
    const child = new ScriptedModel([{ text: CHILD_ANSWER }, { text: CHILD_LATE_ANSWER }])
    const model: ModelPort = {
      identity: parent.identity,
      step: async (args) => {
        const step = {
          assembled: args.assembled,
          tools: args.tools,
          signal: args.signal,
          ...(args.onChunk === undefined ? {} : { onChunk: args.onChunk }),
        }
        if (!JSON.stringify(args.assembled).includes(CHILD_BRIEF)) return parent.step(step)
        const outcome = await child.step(step)
        armed = true
        return outcome
      },
    }

    const rig = await makeRig({
      plane,
      store,
      clock,
      plugins: composePlugins([spawnProbePlugin(state)]),
      model: () => model,
    })
    await seedSession(rig)
    await rig.holder.start()
    await rig.post('spawn one')
    await rig.wake()

    const spawned = await flushUntil({
      check: async () => (await spawnedChildOf(base)) !== undefined,
      clock: rig.clock,
      advanceMs: 500,
      attempts: 200,
    })
    expect(spawned).toBe(true)
    const reached = await flushUntil({
      check: () => gateUsed,
      clock: rig.clock,
      advanceMs: 500,
      attempts: 200,
    })
    expect(reached).toBe(true)

    const childId = await spawnedChildOf(base)
    if (childId === undefined) throw new Error('no child thread')
    await base.post({
      sessionId: SESSION,
      kind: INBOX_KIND_MESSAGE,
      payload: messagePayloadOf({ text: LATE }),
      threadId: childId,
    })
    release()

    const answered = await flushUntil({
      check: async () => (await answeredOn({ plane: base, threadId: childId })) === 2,
      clock: rig.clock,
      advanceMs: 500,
      attempts: 200,
    })
    expect(answered).toBe(true)
    expect(await userSaidOn({ plane: base, threadId: childId })).toEqual([CHILD_BRIEF, LATE])
    expect(
      await base.readInbox({ sessionId: SESSION, afterId: 0, limit: 10, forThread: childId }),
    ).toEqual([])
  }, 25_000)
})
