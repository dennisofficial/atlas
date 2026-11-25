import { describe, expect, it } from 'bun:test'

import {
  ESetupPhase,
  EToolEffect,
  INBOX_KIND_EVENT,
  ToolDefinition,
  inboxEventPayloadOf,
  type Assembled,
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

import { flushUntil, makeRig, seedSession, SESSION, THREAD_ID } from './holder-rig'

const CHILD_BRIEF = 'NOTICE-BRIEF take the first pass'
const ENDING_TEXT = 'NOTICE-CHILD the pass is done'
const CHILD_NOTICE_TEXT = 'NOTICE-SHELL the background build finished'
const SPAWN_PROBE = 'notice_spawn_probe'
const NOTICE_PROBE = 'notice_notify_probe'

type ProbeState = { agentId: string | undefined }

const isChild = (assembled: unknown): boolean => JSON.stringify(assembled).includes(CHILD_BRIEF)

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
      intent: 'notice',
      prompt: CHILD_BRIEF,
    })
    this.state.agentId = snapshot.agentId
    return { ok: true, output: { agentId: snapshot.agentId }, modelText: 'spawned' }
  }
}

class NoticeProbe extends ToolDefinition {
  readonly name = NOTICE_PROBE
  readonly description = 'post a turn-taking notice through the pod context'
  readonly effect = EToolEffect.Write
  readonly inputSchema = z.object({})

  constructor(private readonly ctx: PluginPodContext) {
    super()
  }

  async invoke(): Promise<ToolOutcome> {
    await this.ctx.notify(
      {
        type: 'sandbox-setup-reported',
        text: CHILD_NOTICE_TEXT,
        failed: false,
        phase: ESetupPhase.Finished,
      },
      { key: 'notice-probe:child' },
    )
    return { ok: true, output: {}, modelText: 'notified' }
  }
}

const probePlugin = (state: ProbeState): Plugin =>
  definePlugin({
    name: 'notice-probe',
    events: [],
    views: [],
    commands: [],
    pod: {
      childDeny: [SPAWN_PROBE],
      tools: (ctx) => [new SpawnProbe(ctx, state), new NoticeProbe(ctx)],
      prompts: [],
    },
    control: { hooks: [], commands: new Map() },
    client: { hooks: [] },
    transport: 'none',
  })

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

const queuedEndings = async (rig: Awaited<ReturnType<typeof makeRig>>): Promise<number[]> =>
  (await rig.plane.readInbox({ sessionId: SESSION, afterId: 0, limit: 200 })).flatMap((entry) =>
    entry.kind === INBOX_KIND_EVENT && entry.payload.includes('"agent-ended"')
      ? [entry.inboxId]
      : [],
  )

const ofType = (args: { events: readonly RecordEvent[]; type: string }): RecordEvent[] =>
  args.events.filter((event) => event.type === args.type)

const parentOf = (args: {
  script: readonly ScriptedModelStep[]
  gate?: Promise<void>
}): {
  model: ModelPort
  parent: Assembled[]
} => {
  const parent = new ScriptedModel(args.script)
  const child = new ScriptedModel([{ text: ENDING_TEXT }])
  const requests: Assembled[] = []
  let steps = 0
  return {
    parent: requests,
    model: {
      identity: parent.identity,
      step: async ({ assembled, tools, signal, onChunk }) => {
        const stepArgs = { assembled, tools, signal, ...(onChunk === undefined ? {} : { onChunk }) }
        if (isChild(assembled)) return child.step(stepArgs)
        steps += 1
        requests.push(assembled)
        if (steps === 2 && args.gate !== undefined) await args.gate
        return parent.step(stepArgs)
      },
    },
  }
}

describe('a notice that lands while a model step is in flight', () => {
  it('takes another step after the last one and sees the ending in its context', async () => {
    const state: ProbeState = { agentId: undefined }
    let openGate = (): void => undefined
    const gate = new Promise<void>((resolve) => {
      openGate = () => resolve()
    })
    const scripted = parentOf({
      gate,
      script: [
        { calls: [{ callId: 'c1', name: SPAWN_PROBE, input: {} }] },
        { text: 'parent finished its last step' },
        { text: 'parent saw the ending' },
      ],
    })
    const rig = await makeRig({
      plugins: composePlugins([probePlugin(state)]),
      model: () => scripted.model,
    })
    await seedSession(rig)
    await rig.holder.start()

    await rig.post('spawn one')
    await rig.wake()

    const queued = await flushUntil({
      check: async () => (await queuedEndings(rig)).length > 0,
      clock: rig.clock,
      attempts: 400,
      advanceMs: 1_000,
    })
    expect(queued).toBe(true)
    expect(scripted.parent).toHaveLength(2)
    expect(
      ofType({ events: await eventsIn({ rig, threadId: THREAD_ID }), type: 'agent-ended' }),
    ).toEqual([])

    openGate()

    const stepped = await flushUntil({
      check: () => scripted.parent.length >= 3,
      clock: rig.clock,
      attempts: 400,
      advanceMs: 1_000,
    })
    expect(stepped).toBe(true)

    expect(JSON.stringify(scripted.parent[2]?.messages)).toContain(ENDING_TEXT)
    const parent = await eventsIn({ rig, threadId: THREAD_ID })
    expect(ofType({ events: parent, type: 'agent-ended' })).toMatchObject([
      { status: 'finished', prose: ENDING_TEXT },
    ])
    expect(await queuedEndings(rig)).toEqual([])
  }, 30_000)
})

describe('a notice delivered to a running sub-agent', () => {
  it('appends it at the drain point and the child takes another step that sees it', async () => {
    const state: ProbeState = { agentId: undefined }
    const scripted = parentOf({
      script: [
        { calls: [{ callId: 'c1', name: SPAWN_PROBE, input: {} }] },
        { text: 'parent waiting' },
      ],
    })
    const child = new ScriptedModel([
      { calls: [{ callId: 'n1', name: NOTICE_PROBE, input: {} }] },
      { text: 'child answered' },
    ])
    const split: ModelPort = {
      identity: scripted.model.identity,
      step: async ({ assembled, tools, signal, onChunk }) => {
        const stepArgs = { assembled, tools, signal, ...(onChunk === undefined ? {} : { onChunk }) }
        return isChild(assembled) ? child.step(stepArgs) : scripted.model.step(stepArgs)
      },
    }
    const rig = await makeRig({
      plugins: composePlugins([probePlugin(state)]),
      model: () => split,
    })
    await seedSession(rig)
    await rig.holder.start()

    await rig.post('spawn one')
    await rig.wake()

    const spawned = await flushUntil({
      check: async () =>
        ofType({ events: await eventsIn({ rig, threadId: THREAD_ID }), type: 'agent-spawned' })
          .length > 0,
      clock: rig.clock,
      attempts: 200,
      advanceMs: 1_000,
    })
    expect(spawned).toBe(true)
    const spawnedEvent = ofType({
      events: await eventsIn({ rig, threadId: THREAD_ID }),
      type: 'agent-spawned',
    })[0]
    if (spawnedEvent === undefined || spawnedEvent.type !== 'agent-spawned')
      throw new Error('no spawn')
    const childId = spawnedEvent.agentId

    const noticed = await flushUntil({
      check: async () =>
        ofType({
          events: await eventsIn({ rig, threadId: childId }),
          type: 'sandbox-setup-reported',
        }).length > 0,
      clock: rig.clock,
      attempts: 400,
      advanceMs: 1_000,
    })
    expect(noticed).toBe(true)

    const childEvents = await eventsIn({ rig, threadId: childId })
    expect(ofType({ events: childEvents, type: 'sandbox-setup-reported' })).toMatchObject([
      { text: CHILD_NOTICE_TEXT },
    ])
    expect(child.requests.length).toBeGreaterThanOrEqual(2)
    expect(JSON.stringify(child.requests.at(-1)?.assembled.messages)).toContain(CHILD_NOTICE_TEXT)
  }, 30_000)
})

describe('posting the same notice twice', () => {
  it('leaves one inbox row for the key', async () => {
    const rig = await makeRig({})
    await seedSession(rig)
    const payload = inboxEventPayloadOf({
      event: {
        type: 'sandbox-setup-reported',
        text: 'NOTICE-DUPLICATE',
        failed: false,
        phase: ESetupPhase.Finished,
      },
      clientId: 'duplicate-notice-key',
    })
    await rig.plane.post({ sessionId: SESSION, kind: INBOX_KIND_EVENT, payload })
    await rig.plane.post({ sessionId: SESSION, kind: INBOX_KIND_EVENT, payload })

    const entries = await rig.plane.readInbox({ sessionId: SESSION, afterId: 0, limit: 50 })
    expect(entries.filter((entry) => entry.kind === INBOX_KIND_EVENT)).toHaveLength(1)
    expect(entries.filter((entry) => entry.kind === INBOX_KIND_EVENT)[0]?.payload).toContain(
      'NOTICE-DUPLICATE',
    )
  })
})
