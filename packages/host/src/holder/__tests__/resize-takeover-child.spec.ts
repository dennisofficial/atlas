import { describe, expect, it } from 'bun:test'

import {
  composeCommands,
  defineCommand,
  ECommandGroup,
  ECommandRunsIn,
  type CommandHandler,
} from '@dltech/atlas-commands'
import {
  chainEvents,
  EAgentStart,
  EInputConsumed,
  EPodResizeNotice,
  INBOX_KIND_RECORD,
  inboxEventPayloadOf,
  toRunId,
  toThreadId,
  type ModelPort,
  type ThreadId,
  type RecordEventBody,
  type RecordEvent,
} from '@dltech/atlas-core'
import { ScriptedModel } from '@dltech/atlas-agent/testing'
import { z } from 'zod'

import { FakeClock, flushUntil, makeRig, seedSession, SESSION, THREAD_ID } from './holder-rig'

type Rig = Awaited<ReturnType<typeof makeRig>>

const CHILD = toThreadId('thread-child-resize-takeover')
const BRIEF = 'RESIZE-BRIEF read the log'
const CHILD_ANSWER = 'RESIZE-CHILD done'
const GENERATION = 3

const holdProbe = defineCommand({
  spec: {
    name: 'summarise',
    summary: 'holds the takeover open until the spec lets it go',
    group: ECommandGroup.Context,
    args: z.strictObject({ word: z.string() }),
    runsIn: ECommandRunsIn.Host,
    fromText: (text) => ({ ok: true, args: { word: text } }),
  },
})

const SPAWN: RecordEventBody = {
  type: 'agent-spawned',
  agentId: CHILD,
  agentType: 'general-purpose',
  intent: 'resize',
  mode: EAgentStart.Fresh,
}

const STARTED: RecordEventBody = {
  type: 'pod-resize-started',
  vcpus: 16,
  memoryGb: 64,
  generation: GENERATION,
}

const RESIZED = {
  type: 'pod-resized' as const,
  vcpus: 16,
  memoryGb: 64,
  generation: GENERATION,
  outcome: EPodResizeNotice.Applied,
}

const eventsIn = async (args: { rig: Rig; threadId: ThreadId }): Promise<RecordEvent[]> => {
  const events: RecordEvent[] = []
  let afterSeq = 0
  for (;;) {
    const page = await args.rig.plane.readEvents({
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

const typesIn = async (args: { rig: Rig; threadId: ThreadId }): Promise<string[]> =>
  (await eventsIn(args)).map((event) => event.type)

const countOf = (args: { types: readonly string[]; type: string }): number =>
  args.types.filter((seen) => seen === args.type).length

const appendSeeded = async (args: {
  rig: Rig
  threadId: ThreadId
  epoch: number
  at: string
  bodies: readonly RecordEventBody[]
}): Promise<void> => {
  const head = await args.rig.plane.head({ threadId: args.threadId })
  const outcome = await args.rig.plane.append({
    threadId: args.threadId,
    epoch: args.epoch,
    events: chainEvents({
      threadId: args.threadId,
      runId: toRunId('seed-run'),
      epoch: args.epoch,
      from: head,
      at: args.at,
      bodies: args.bodies,
    }),
  })
  if (!outcome.ok) throw new Error(`seed refused: ${JSON.stringify(outcome.refusal)}`)
}

type Probe = { calls: number; armed: boolean | undefined; holding: boolean }

const probeOf = (): {
  probe: Probe
  handler: CommandHandler<unknown>
  release(): void
} => {
  const probe: Probe = { calls: 0, armed: undefined, holding: false }
  let letGo = (): void => {}
  const held = new Promise<void>((resolve) => {
    letGo = () => resolve()
  })
  return {
    probe,
    handler: async ({ append }) => {
      probe.holding = true
      await append([{ type: 'fact-recorded', key: 'hold', kind: 'test', value: 'held' }])
      await held
      return { kind: 'done' }
    },
    release: () => letGo(),
  }
}

const isChild = (assembled: unknown): boolean => JSON.stringify(assembled).includes(BRIEF)

const childModelOf = (args: { probe: Probe; armed(): boolean }): ModelPort => {
  const parent = new ScriptedModel([{ text: 'parent idle' }])
  const child = new ScriptedModel([
    { calls: [{ callId: 'child-bash', name: 'bash', input: { command: 'echo child-ran' } }] },
    { text: CHILD_ANSWER },
  ])
  return {
    identity: parent.identity,
    step: async ({ assembled, tools, signal, onChunk }) => {
      const step = { assembled, tools, signal, ...(onChunk === undefined ? {} : { onChunk }) }
      if (!isChild(assembled)) return parent.step(step)
      args.probe.calls += 1
      if (args.probe.calls === 1) args.probe.armed = args.armed()
      return child.step(step)
    },
  }
}

const seedTakeover = async (args: {
  model: ModelPort
  handler: CommandHandler<unknown>
}): Promise<Rig> => {
  const clock = new FakeClock()
  clock.current = Date.now()
  const rig = await makeRig({
    model: () => args.model,
    clock,
    commands: composeCommands([holdProbe]),
    commandHandlers: new Map([[holdProbe.inboxKind, args.handler]]),
  })
  const at = new Date(clock.current).toISOString()
  await seedSession(rig)
  const lease = await rig.plane.grant({ sessionId: SESSION, hostId: 1 })
  await rig.plane.createThread({ threadId: CHILD, sessionId: SESSION })
  const posted = await rig.plane.post({
    sessionId: SESSION,
    kind: holdProbe.inboxKind,
    payload: JSON.stringify({ word: 'hold' }),
  })
  await appendSeeded({
    rig,
    threadId: THREAD_ID,
    epoch: lease.epoch,
    at,
    bodies: [
      { type: 'workspace-prepared' },
      SPAWN,
      STARTED,
      {
        type: 'input-posted',
        inboxId: posted.inboxId,
        kind: holdProbe.inboxKind,
        postedAt: at,
      },
      { type: 'input-consumed', inboxId: posted.inboxId, consumed: EInputConsumed.Command },
    ],
  })
  await appendSeeded({
    rig,
    threadId: CHILD,
    epoch: lease.epoch,
    at,
    bodies: [{ type: 'user-said', text: BRIEF }],
  })
  await rig.plane.revoke({ sessionId: SESSION, wantsHolder: true })
  return rig
}

const postResized = async (rig: Rig): Promise<void> => {
  await rig.plane.post({
    sessionId: SESSION,
    kind: INBOX_KIND_RECORD,
    payload: inboxEventPayloadOf({ event: RESIZED, clientId: `pod-resized:${GENERATION}` }),
  })
  await rig.wake()
}

const childTypes = (rig: Rig): Promise<string[]> => typesIn({ rig, threadId: CHILD })

describe('a takeover that adopts a child while a resize is open', () => {
  it('holds the child dispatch until the log reports the resize, then runs it once', async () => {
    const control = probeOf()
    const live: { rig: Rig | undefined } = { rig: undefined }
    const armed = (): boolean => live.rig?.runtimes.at(-1)?.remoteCalls.resizeHeld() !== undefined
    const rig = await seedTakeover({
      model: childModelOf({ probe: control.probe, armed }),
      handler: control.handler,
    })
    live.rig = rig
    await rig.holder.start()
    await rig.wake()

    const holding = await flushUntil({
      check: () => control.probe.holding,
      clock: rig.clock,
      attempts: 200,
      advanceMs: 500,
    })
    expect(holding).toBe(true)
    const resumed = await flushUntil({
      check: () => control.probe.calls > 0,
      clock: rig.clock,
      attempts: 200,
      advanceMs: 500,
    })
    expect(resumed).toBe(true)
    expect(control.probe.armed).toBe(true)

    const early = await flushUntil({
      check: async () => countOf({ types: await childTypes(rig), type: 'tool-dispatched' }) > 0,
      clock: rig.clock,
      attempts: 80,
      advanceMs: 500,
    })
    expect(early).toBe(false)
    expect(countOf({ types: await childTypes(rig), type: 'tool-result' })).toBe(0)

    control.release()
    await postResized(rig)
    const ran = await flushUntil({
      check: async () => {
        const types = await childTypes(rig)
        return (
          countOf({ types, type: 'tool-dispatched' }) === 1 &&
          countOf({ types, type: 'tool-result' }) === 1
        )
      },
      clock: rig.clock,
      attempts: 400,
      advanceMs: 2_000,
    })
    expect(ran).toBe(true)

    const after = await childTypes(rig)
    expect(countOf({ types: after, type: 'tool-dispatched' })).toBe(1)
    expect(countOf({ types: after, type: 'tool-result' })).toBe(1)
    expect(await typesIn({ rig, threadId: THREAD_ID })).toContain('pod-resized')
    rig.holder.discard()
  }, 40_000)
})
