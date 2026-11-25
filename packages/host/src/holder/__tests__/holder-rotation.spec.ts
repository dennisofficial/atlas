import { describe, expect, it } from 'bun:test'

import { ScriptedModel } from '@dltech/atlas-agent/testing'
import { SequentialIds } from '@dltech/atlas-agent/testing'
import {
  composeCommands,
  defineCommand,
  ECommandGroup,
  ECommandRunsIn,
  type CommandHandler,
} from '@dltech/atlas-commands'
import {
  chainEvents,
  type ModelPort,
  toRunId,
  toThreadId,
  type LogHead,
  type RecordEventBody,
  type RecordEvent,
} from '@dltech/atlas-core'
import { ELogSeverity, LogPort, type LogEntry } from '@dltech/atlas-observability'
import { z } from 'zod'

import type { HeldRotationRecord } from '../rotation'
import { HeldRotation } from '../rotation'
import { SessionRecord } from '../record/record-adapter'
import { flushUntil, makeRig, seedSession, SESSION, THREAD } from './holder-rig'

const THREAD_ID = toThreadId(THREAD)

class RecordingLog extends LogPort {
  readonly entries: LogEntry[] = []
  record(entry: LogEntry): void {
    this.entries.push(entry)
  }
  warnings(): string[] {
    return this.entries
      .filter((entry) => entry.severity === ELogSeverity.Warn)
      .map((entry) => entry.message)
  }
}

type Rig = Awaited<ReturnType<typeof makeRig>>

const AT = '2026-11-23T12:00:00.000Z'

const appendBodies = async (args: {
  rig: Rig
  epoch: number
  bodies: readonly RecordEventBody[]
}): Promise<{ head: LogHead; events: RecordEvent[] }> => {
  const from = await args.rig.plane.head({ threadId: THREAD_ID })
  const events = chainEvents({
    threadId: THREAD_ID,
    runId: toRunId('seed-run'),
    epoch: args.epoch,
    at: AT,
    bodies: args.bodies,
    from,
  })
  const outcome = await args.rig.plane.append({
    threadId: THREAD_ID,
    epoch: args.epoch,
    events,
  })
  if (!outcome.ok) throw new Error(`append refused: ${JSON.stringify(outcome.refusal)}`)
  return { head: outcome.head, events }
}

const seedOf = async (args: { rig: Rig; used: number }): Promise<number> => {
  await seedSession(args.rig)
  const { epoch } = await args.rig.plane.grant({ sessionId: SESSION, hostId: 1 })
  await appendBodies({
    rig: args.rig,
    epoch,
    bodies: [
      {
        type: 'assistant-said',
        parts: [{ type: 'text', text: 'work so far' }],
        usage: { inputTokens: args.used, outputTokens: 0, contextWindow: 1_000 },
      },
    ],
  })
  return epoch
}

const EVENT_AT = '2026-11-23T12:00:00.000Z'

const userSaidEvent = (): RecordEvent =>
  ({
    type: 'user-said',
    seq: 0,
    id: 'event-0',
    threadId: THREAD_ID,
    runId: toRunId('run-0'),
    epoch: 1,
    at: EVENT_AT,
    text: 'do the work',
  }) as unknown as RecordEvent

const usageEvent = (used: number): RecordEvent =>
  ({
    type: 'assistant-said',
    seq: 1,
    id: 'event-1',
    threadId: THREAD_ID,
    runId: toRunId('run-1'),
    epoch: 1,
    at: EVENT_AT,
    parts: [{ type: 'text', text: 'work so far' }],
    usage: { inputTokens: used, outputTokens: 0, contextWindow: 1_000 },
  }) as unknown as RecordEvent

const rotationOver = (args: {
  used: number
  atPercent: number
  model: ModelPort
  runningChildren?: (() => number) | undefined
  log?: RecordingLog | undefined
}): { rotation: HeldRotation; appended: readonly unknown[] } => {
  const appended: unknown[] = []
  const events = [userSaidEvent(), usageEvent(args.used)]
  const record: HeldRotationRecord = {
    threadId: THREAD_ID,
    eventCache: () => ({
      eventsAfter: () => events,
      visibleLoopEvents: () => events,
    }),
    append: async ({ drafts }: { drafts: readonly unknown[] }) => {
      appended.push(...drafts)
      return []
    },
  } as unknown as HeldRotationRecord
  return {
    rotation: new HeldRotation({
      record: () => record,
      runtime: () => ({ model: args.model, rotation: { autoRotateAtPercent: args.atPercent } }),
      ids: new SequentialIds(),
      runningChildren: args.runningChildren ?? (() => 0),
      ...(args.log === undefined ? {} : { log: args.log }),
    }),
    appended,
  }
}

describe('HeldRotation', () => {
  it('appends one rotated at the threshold, with the measured percent', async () => {
    const { rotation, appended } = rotationOver({
      used: 900,
      atPercent: 50,
      model: new ScriptedModel([{ text: 'the brief' }]),
    })

    await rotation.maybeAutoRotate()

    expect(appended).toEqual([{ type: 'rotated', handoff: 'the brief', auto: { percent: 90 } }])
  })

  it('holds below the threshold', async () => {
    const { rotation, appended } = rotationOver({
      used: 900,
      atPercent: 95,
      model: new ScriptedModel([{ text: 'the brief' }]),
    })

    await rotation.maybeAutoRotate()

    expect(appended).toEqual([])
  })

  it('holds when the setting is zero', async () => {
    const { rotation, appended } = rotationOver({
      used: 900,
      atPercent: 0,
      model: new ScriptedModel([{ text: 'the brief' }]),
    })

    await rotation.maybeAutoRotate()

    expect(appended).toEqual([])
  })

  it('skips while a child runs', async () => {
    const model = new ScriptedModel([{ text: 'the brief' }])
    const { rotation, appended } = rotationOver({
      used: 900,
      atPercent: 50,
      model,
      runningChildren: () => 1,
    })

    await rotation.maybeAutoRotate()

    expect(model.requests).toEqual([])
    expect(appended).toEqual([])
  })

  it('appends nothing and logs the refusal when the handoff fails', async () => {
    const log = new RecordingLog()
    const { rotation, appended } = rotationOver({
      used: 900,
      atPercent: 50,
      model: new ScriptedModel([{ throws: new Error('no handoff') }]),
      log,
    })

    await rotation.maybeAutoRotate()

    expect(appended).toEqual([])
    expect(log.warnings().some((line) => line.includes('The handoff could not be written'))).toBe(
      true,
    )
  })
})

describe('SessionRecord rotation projection', () => {
  it('read() cuts at the boundary while composedEvents() keeps the whole log', async () => {
    const rig = await makeRig({})
    const epoch = await seedOf({ rig, used: 0 })
    await appendBodies({
      rig,
      epoch,
      bodies: [
        { type: 'user-said', text: 'hello' },
        { type: 'rotated', handoff: 'the brief' },
      ],
    })

    const record = await SessionRecord.open({
      plane: rig.plane,
      threadId: THREAD_ID,
      epoch,
      timers: rig.clock,
      remoteCalls: { handoff: () => {} } as never,
      daemonTools: new Set<string>(),
      nowIso: () => AT,
    })

    const projected = await record.read({ threadId: THREAD_ID })
    expect(projected.events.length).toBe(1)
    expect(projected.events[0]?.type).toBe('rotated')

    const composed = await record.composedEvents({ threadId: THREAD_ID })
    expect(composed.some((event) => event.type === 'user-said')).toBe(true)

    await appendBodies({ rig, epoch, bodies: [{ type: 'history-rewound', toSeq: 2 }] })
    const reopened = await SessionRecord.open({
      plane: rig.plane,
      threadId: THREAD_ID,
      epoch,
      timers: rig.clock,
      remoteCalls: { handoff: () => {} } as never,
      daemonTools: new Set<string>(),
      nowIso: () => AT,
    })
    const restored = await reopened.read({ threadId: THREAD_ID })
    expect(restored.events.some((event) => event.type === 'rotated')).toBe(false)
    expect(restored.events.some((event) => event.type === 'user-said')).toBe(true)
  }, 20_000)
})

describe('childrenRunning in the command context', () => {
  it('reaches a host command handler', async () => {
    const seen: number[] = []
    const probe = defineCommand({
      spec: {
        name: 'probe',
        summary: 'Report how many sub-agents run',
        group: ECommandGroup.Context,
        args: z.strictObject({}),
        runsIn: ECommandRunsIn.Host,
      },
    })
    const handler: CommandHandler<unknown> = async (context) => {
      seen.push(context.runningChildren())
      return { kind: 'done' }
    }
    const rig = await makeRig({
      commands: composeCommands([probe]),
      commandHandlers: new Map([[probe.inboxKind, handler]]),
    })
    await seedSession(rig)
    await rig.holder.start()

    await rig.plane.post({ sessionId: SESSION, kind: probe.inboxKind, payload: '{}' })
    await rig.wake()
    await flushUntil({
      check: async () => seen.length === 1,
      clock: rig.clock,
      advanceMs: 2_000,
      attempts: 200,
    })

    expect(seen).toEqual([0])
  }, 20_000)
})
