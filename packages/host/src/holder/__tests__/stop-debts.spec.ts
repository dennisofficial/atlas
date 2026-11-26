import { describe, expect, it } from 'bun:test'

import { ControlPlane } from '@dltech/atlas-control'
import { InMemoryControlStore } from '@dltech/atlas-control/testing'
import {
  chainEvents,
  ECompactionAnchor,
  toCallId,
  toRunId,
  toThreadId,
  type LogHead,
  type RecordEventBody,
  type RunId,
  type ThreadId,
} from '@dltech/atlas-core'
import { EDaemonCapability } from '@dltech/atlas-protocol'

import { scopeKeyOf } from '../../calls/call-scope'
import type { ScopeCancelled } from '../../calls/remote-calls'
import { RecordCache } from '../record/record-cache'
import {
  oweChildStoppedCalls,
  payStopDebts,
  watchStopDebts,
  type FactDraft,
  type StopDebtCalls,
  type StopDebtPorts,
  type StopDebtRecord,
  type StopDebtSource,
} from '../stop-debts'

const SESSION = 'session-1'
const THREAD = toThreadId('thread-1')
const CHILD = toThreadId('thread-2')
const AT = '2026-11-26T12:00:00.000Z'
const SCOPE_OPEN = scopeKeyOf({ runId: 'run-1', callId: 'call-open' })
const SCOPE_CHILD = scopeKeyOf({ runId: 'run-1', callId: 'call-child' })

type MemoryRecord = StopDebtRecord &
  StopDebtSource & {
    appends: FactDraft[][]
    enqueue(bodies: readonly RecordEventBody[]): Promise<void>
  }

const openThread = async (): Promise<{ plane: ControlPlane; epoch: number }> => {
  const plane = new ControlPlane({ store: new InMemoryControlStore({ clock: () => AT }) })
  await plane.createSession({
    sessionId: SESSION,
    userId: 'user-1',
    projectId: 'project-1',
    mainThreadId: THREAD,
  })
  await plane.createThread({ threadId: CHILD, sessionId: SESSION })
  const { epoch } = await plane.grant({ sessionId: SESSION, hostId: 1 })
  return { plane, epoch }
}

const appendTo = async (args: {
  plane: ControlPlane
  epoch: number
  threadId: ThreadId
  bodies: readonly RecordEventBody[]
  runId?: RunId | undefined
}): Promise<void> => {
  const from: LogHead = await args.plane.head({ threadId: args.threadId })
  const events = chainEvents({
    threadId: args.threadId,
    runId: args.runId ?? toRunId('run-1'),
    epoch: args.epoch,
    at: AT,
    bodies: args.bodies,
    from,
  })
  const outcome = await args.plane.append({
    threadId: args.threadId,
    epoch: args.epoch,
    events,
  })
  if (!outcome.ok) throw new Error(`append refused: ${JSON.stringify(outcome.refusal)}`)
}

const owedFact = (scope: string): FactDraft => ({
  type: 'fact-recorded',
  key: `stop-owed:${scope}`,
  kind: 'stop-owed',
})

const openCall = (callId: string): readonly RecordEventBody[] => [
  { type: 'tool-called', callId: toCallId(callId), name: 'bash', input: {}, ordinal: 0 },
  { type: 'tool-dispatched', callId: toCallId(callId), name: 'bash' },
]

type Gate = {
  hold(): void
  release(): void
  reached(): boolean
  untilReleased(): Promise<void>
}

const gateOf = (): Gate => {
  let held = false
  let arrived = false
  const waiting: (() => void)[] = []
  return {
    hold: () => {
      held = true
      arrived = false
    },
    release: () => {
      held = false
      for (const resolve of waiting.splice(0)) resolve()
    },
    reached: () => arrived,
    untilReleased: async () => {
      if (!held) return
      arrived = true
      await new Promise<void>((resolve) => waiting.push(resolve))
    },
  }
}

const recordOf = async (args: {
  plane: ControlPlane
  epoch: number
  threadId: ThreadId
  gate?: Gate | undefined
}): Promise<MemoryRecord> => {
  let cache = await RecordCache.load({ plane: args.plane, threadId: args.threadId })
  const appends: FactDraft[][] = []
  let tail: Promise<void> = Promise.resolve()
  const queue = <T>(work: () => Promise<T>): Promise<T> => {
    const run = tail.then(work)
    tail = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }
  const enqueue = (next: {
    bodies: readonly RecordEventBody[]
    runId: RunId
    threadId: ThreadId
  }): Promise<void> =>
    queue(async () => {
      await gate?.untilReleased()
      await appendTo({
        plane: args.plane,
        epoch: args.epoch,
        threadId: next.threadId,
        bodies: next.bodies,
        runId: next.runId,
      })
      cache = await RecordCache.load({ plane: args.plane, threadId: args.threadId })
    })
  const gate = args.gate
  return {
    threadId: args.threadId,
    appends,
    queue,
    eventCache: () => cache,
    enqueue: (bodies) => enqueue({ bodies, runId: toRunId('run-1'), threadId: args.threadId }),
    append: ({ threadId, runId, drafts }) => {
      appends.push([...drafts])
      return enqueue({ bodies: drafts, runId, threadId })
    },
  }
}

const callsOf = (capabilities: readonly string[]) => {
  const sent: string[] = []
  let listener: ((cancelled: ScopeCancelled) => void) | undefined
  const calls: StopDebtCalls = {
    daemonCapabilities: () => capabilities,
    cancelScope: (args) => {
      sent.push(args.scope)
    },
    onReady: () => () => {},
    onScopeCancelled: (registered) => {
      listener = registered
      return () => {}
    },
  }
  return {
    calls,
    sent,
    confirm: (cancelled: readonly string[]) => {
      for (const scope of cancelled) listener?.({ scope, cancelled })
    },
  }
}

const portsOf = (args: { record: StopDebtRecord; calls: StopDebtCalls }): StopDebtPorts => ({
  ...args,
  runId: () => toRunId('run-2'),
})

const CAN = [EDaemonCapability.CancelScope]

const factKeysOf = (record: StopDebtRecord): readonly string[] =>
  record
    .eventCache()
    .eventsAfter(0)
    .flatMap((event) => (event.type === 'fact-recorded' ? [event.key] : []))

const until = async (ready: () => boolean): Promise<void> => {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    if (ready()) return
    await new Promise((resolve) => setTimeout(resolve, 1))
  }
  throw new Error('the record never caught up with the append')
}

describe('stop debts of a stopped turn', () => {
  it('sends cancel-scope for each scope still owed', async () => {
    const { plane, epoch } = await openThread()
    await appendTo({ plane, epoch, threadId: THREAD, bodies: [owedFact(SCOPE_OPEN)] })
    const record = await recordOf({ plane, epoch, threadId: THREAD })
    const { calls, sent } = callsOf(CAN)

    payStopDebts(portsOf({ record, calls }))

    expect(sent).toEqual([SCOPE_OPEN])
  })

  it('sends nothing when the daemon cannot cancel a scope', async () => {
    const { plane, epoch } = await openThread()
    await appendTo({ plane, epoch, threadId: THREAD, bodies: [owedFact(SCOPE_OPEN)] })
    const record = await recordOf({ plane, epoch, threadId: THREAD })
    const { calls, sent } = callsOf([EDaemonCapability.ExecDeadline])

    payStopDebts(portsOf({ record, calls }))

    expect(sent).toEqual([])
  })

  it('retires the debt when the daemon confirms the scope, so the next holder sends nothing', async () => {
    const { plane, epoch } = await openThread()
    await appendTo({ plane, epoch, threadId: THREAD, bodies: [owedFact(SCOPE_OPEN)] })
    const record = await recordOf({ plane, epoch, threadId: THREAD })
    const { calls, sent, confirm } = callsOf(CAN)
    const ports = portsOf({ record, calls })
    watchStopDebts(ports)

    payStopDebts(ports)
    confirm([SCOPE_OPEN])
    await until(() => factKeysOf(record).includes(`stop-paid:${SCOPE_OPEN}`))
    payStopDebts(ports)

    expect(record.appends.flat().map((draft) => draft.key)).toEqual([`stop-paid:${SCOPE_OPEN}`])
    expect(sent).toEqual([SCOPE_OPEN])
  })

  it('still pays the debt after a summary hid the events around it', async () => {
    const { plane, epoch } = await openThread()
    await appendTo({
      plane,
      epoch,
      threadId: THREAD,
      bodies: [owedFact(SCOPE_OPEN)],
    })
    await appendTo({
      plane,
      epoch,
      threadId: THREAD,
      bodies: [
        {
          type: 'history-summarised',
          fromSeq: 1,
          throughSeq: 2,
          anchor: ECompactionAnchor.Prefix,
          summary: 'the stopped work',
        },
      ],
    })
    const record = await recordOf({ plane, epoch, threadId: THREAD })
    const { calls, sent } = callsOf(CAN)

    payStopDebts(portsOf({ record, calls }))

    expect(sent).toEqual([SCOPE_OPEN])
  })

  it('drops a debt that a later dispatch of the same call id re-used', async () => {
    const { plane, epoch } = await openThread()
    await appendTo({
      plane,
      epoch,
      threadId: THREAD,
      bodies: [owedFact(SCOPE_OPEN), ...openCall('call-open')],
    })
    const record = await recordOf({ plane, epoch, threadId: THREAD })
    const { calls, sent } = callsOf(CAN)

    payStopDebts(portsOf({ record, calls }))

    expect(sent).toEqual([])
  })
})

describe('stop debts of a stopped child run', () => {
  it("owes the child's open call scopes in the parent record", async () => {
    const { plane, epoch } = await openThread()
    await appendTo({
      plane,
      epoch,
      threadId: CHILD,
      bodies: openCall('call-child'),
    })
    const child = await recordOf({ plane, epoch, threadId: CHILD })
    const parent = await recordOf({ plane, epoch, threadId: THREAD })

    await oweChildStoppedCalls({
      child,
      parent,
      runId: () => toRunId('run-2'),
    })

    expect(parent.appends.flat().map((draft) => draft.key)).toEqual([`stop-owed:${SCOPE_CHILD}`])
    const { calls, sent } = callsOf(CAN)
    payStopDebts(portsOf({ record: parent, calls }))
    expect(sent).toEqual([SCOPE_CHILD])
  })

  it('owes a child dispatch that was still committing when the child stopped', async () => {
    const { plane, epoch } = await openThread()
    const gate = gateOf()
    const child = await recordOf({ plane, epoch, threadId: CHILD, gate })
    const parent = await recordOf({ plane, epoch, threadId: THREAD })
    gate.hold()
    const appending = child.enqueue(openCall('call-child'))
    await until(() => gate.reached())
    const owed = oweChildStoppedCalls({ child, parent, runId: () => toRunId('run-2') })
    gate.release()
    await Promise.all([appending, owed])

    expect(parent.appends.flat().map((draft) => draft.key)).toEqual([`stop-owed:${SCOPE_CHILD}`])
  })
})
