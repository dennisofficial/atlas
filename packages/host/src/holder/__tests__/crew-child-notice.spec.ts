import { describe, expect, it } from 'bun:test'

import {
  EAgentLostCause,
  EAgentStatus,
  EReportKind,
  EShellStatus,
  EToolEffect,
  ToolDefinition,
  lostAgentEnding,
  toThreadId,
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
import { ScriptedModel } from '@dltech/atlas-agent/testing'
import { z } from 'zod'

import { ChildTranscript } from '../crew/child-transcript'
import { endingKeyOf, postNotice, threadLastSeq } from '../crew/child-reports'
import type { HeldSessionDeps } from '../held-session-deps'
import type { SessionRecord } from '../record/record-adapter'
import { RIG_MODEL_CHOICE } from './rig-runtime'
import { flushUntil, makeRig, seedSession, SESSION, THREAD_ID, type HolderRig } from './holder-rig'

const CHILD_BRIEF = 'NOTICE-BRIEF take the first pass'
const SHELL_ID = 'bash_notice_1'
const SHELL_COMMAND = 'bun test --watch'
const GRAB_PROBE = 'notice_grab_probe'
const SPAWN_PROBE = 'notice_spawn_probe'
const GATE = 'notice-parent-gate'

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
      intent: 'notice',
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
    name: 'notice-probe',
    events: [],
    views: [],
    commands: [],
    pod: {
      childDeny: [SPAWN_PROBE],
      tools: (ctx) => [new SpawnProbe(ctx), new GrabProbe(ctx, state)],
      prompts: [],
      commands: new Map(),
    },
    control: { hooks: [], commands: new Map() },
    client: { hooks: [] },
    transport: 'none',
  })

const eventsIn = async (
  rig: Awaited<ReturnType<typeof makeRig>>,
  threadId: string,
): Promise<V2Event[]> =>
  (
    await rig.plane.readEvents({
      threadId: threadId as typeof THREAD_ID,
      afterSeq: 0,
      limit: 500,
      visible: false,
    })
  ).events

const childIdOf = (events: readonly V2Event[]): string | undefined =>
  events.flatMap((event) => (event.type === 'agent-spawned' ? [event.agentId] : []))[0]

const saidTexts = (events: readonly V2Event[]): string[] =>
  events.flatMap((event) =>
    event.type === 'assistant-said'
      ? event.parts.flatMap((part) => (part.type === 'text' ? [part.text] : []))
      : [],
  )

const endingQueued = async (rig: Awaited<ReturnType<typeof makeRig>>): Promise<boolean> =>
  (await rig.plane.readInbox({ sessionId: SESSION, afterId: 0, limit: 200 })).some(
    (entry) => entry.kind === 'event' && entry.payload.includes('"agent-ended"'),
  )

const shellEnding = {
  type: 'background-shell-ended' as const,
  shellId: SHELL_ID,
  command: SHELL_COMMAND,
  status: EShellStatus.Exited,
  exitCode: 0,
  output: 'all green',
  droppedCharacters: 0,
  remainingCharacters: 0,
}

describe('a sub-agent that already settled', () => {
  it('resumes on a notice and steps with the notice in context', async () => {
    const state: NoticeState = { child: undefined }
    let gateOpen = false
    const parent = new ScriptedModel(
      [
        { calls: [{ callId: 'c1', name: SPAWN_PROBE, input: {} }] },
        { text: 'parent busy', gateFile: GATE },
        { text: 'saw the ending' },
        { text: 'parent idle' },
        { text: 'parent idle again' },
      ],
      undefined,
      () => gateOpen,
    )
    const child = new ScriptedModel([
      { calls: [{ callId: 'n1', name: GRAB_PROBE, input: {} }] },
      { text: 'child answer' },
      { text: 'saw the shell ending' },
    ])
    const model: ModelPort = {
      identity: parent.identity,
      step: async (args) =>
        JSON.stringify(args.assembled).includes(CHILD_BRIEF) ? child.step(args) : parent.step(args),
    }
    const rig = await makeRig({
      plugins: composePlugins([noticeProbePlugin(state)]),
      model: () => model,
    })
    await seedSession(rig)
    await rig.holder.start()

    await rig.post('spawn one')
    await rig.wake()
    const answered = await flushUntil({
      check: async () => {
        const childId = childIdOf(await eventsIn(rig, THREAD_ID))
        return childId !== undefined && saidTexts(await eventsIn(rig, childId)).length === 1
      },
      clock: rig.clock,
    })
    expect(answered).toBe(true)
    const childId = childIdOf(await eventsIn(rig, THREAD_ID))
    if (childId === undefined) throw new Error('no spawn')
    const childCtx = state.child
    if (childCtx === undefined) throw new Error('the sub-agent never ran a tool')

    const settled = await flushUntil({
      check: async () => await endingQueued(rig),
      clock: rig.clock,
      attempts: 200,
    })
    expect(settled).toBe(true)
    await rig.flush()
    await childCtx.notify(shellEnding, { key: `background-shell-ended:${SHELL_ID}` })

    const resumed = await flushUntil({
      check: async () => saidTexts(await eventsIn(rig, childId)).length === 2,
      clock: rig.clock,
      attempts: 400,
    })
    gateOpen = true
    expect(resumed).toBe(true)
    expect(saidTexts(await eventsIn(rig, childId))).toEqual([
      'child answer',
      'saw the shell ending',
    ])
    expect(JSON.stringify(child.requests.at(-1)?.assembled)).toContain(SHELL_ID)
    expect(JSON.stringify(child.requests.at(-1)?.assembled)).toContain(SHELL_COMMAND)
  }, 30_000)
})

const CHILD_THREAD = toThreadId('thread-notice-child')
const NOTICE_AGENT = {
  agentId: CHILD_THREAD,
  agentType: 'general-purpose',
  intent: 'notice',
  spawnedAt: new Date(0).toISOString(),
  worktree: undefined,
}

const transcriptOn = (args: { rig: HolderRig; seq: number }): ChildTranscript =>
  new ChildTranscript({
    deps: {
      sessionId: SESSION,
      ids: { nextRunId: () => 'run-1' },
      plane: args.rig.plane,
    } as unknown as HeldSessionDeps,
    runtime: { modelLabelOf: (ref) => ref.modelId },
    model: RIG_MODEL_CHOICE,
    parentRecord: {} as SessionRecord,
    parentThreadId: THREAD_ID,
    agentId: CHILD_THREAD,
    agentType: 'general-purpose',
    intent: 'notice',
    lastSeq: () => args.seq,
  })

const noticeRows = async (rig: HolderRig, type: string): Promise<string[]> =>
  (await rig.plane.readInbox({ sessionId: SESSION, afterId: 0, limit: 200 })).flatMap((entry) => {
    if (entry.kind !== 'event' || !entry.payload.includes(`"${type}"`)) return []
    const clientId: unknown = JSON.parse(entry.payload).clientId
    return typeof clientId === 'string' ? [clientId] : []
  })

describe('a report from an adopted sub-agent', () => {
  it('reaches the inbox beside the report its previous holder posted', async () => {
    const rig = await makeRig({})
    await seedSession(rig)

    await transcriptOn({ rig, seq: 4 }).reported({ kind: EReportKind.Blocked, text: 'first' })
    await transcriptOn({ rig, seq: 9 }).reported({ kind: EReportKind.Blocked, text: 'second' })

    expect(await noticeRows(rig, 'agent-reported')).toEqual([
      `agent-reported:${CHILD_THREAD}:4`,
      `agent-reported:${CHILD_THREAD}:9`,
    ])
  })
})

describe('a takeover ending and a late real ending', () => {
  it('land as one inbox row for the same child state', async () => {
    const rig = await makeRig({})
    await seedSession(rig)
    await rig.plane.createThread({ threadId: CHILD_THREAD, sessionId: SESSION })
    const seq = await threadLastSeq({ plane: rig.plane, threadId: CHILD_THREAD })
    const parent = { deps: { sessionId: SESSION, plane: rig.plane } as unknown as HeldSessionDeps }
    const key = endingKeyOf({ agentId: CHILD_THREAD, seq })

    await postNotice(parent, {
      event: lostAgentEnding({
        agent: NOTICE_AGENT,
        progress: { turns: 0, toolCalls: 0, prose: '' },
        lost: { cause: EAgentLostCause.RecordUnreadable, detail: 'its record is gone' },
      }),
      key,
    })
    await postNotice(parent, {
      event: {
        type: 'agent-ended',
        agentId: CHILD_THREAD,
        agentType: 'general-purpose',
        intent: 'notice',
        status: EAgentStatus.Finished,
        prose: 'done',
        turns: 1,
        toolCalls: 0,
      },
      key,
    })

    expect(await noticeRows(rig, 'agent-ended')).toEqual([key])
  })
})
