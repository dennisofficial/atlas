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
} from '@dltech/atlas-core'
import { EDaemonCapability } from '@dltech/atlas-protocol'

import { scopeKeyOf } from '../../calls/call-scope'
import type { ScopeCancelled } from '../../calls/remote-calls'
import { RecordCache } from '../record/record-cache'
import {
  oweStoppedCalls,
  payStopDebts,
  watchStopDebts,
  type FactDraft,
  type StopDebtCalls,
  type StopDebtPorts,
  type StopDebtRecord,
} from '../stop-debts'

const SESSION = 'session-1'
const THREAD = toThreadId('thread-1')
const AT = '2026-11-26T12:00:00.000Z'
const SCOPE_OPEN = scopeKeyOf({ runId: 'run-1', callId: 'call-open' })
const SCOPE_DONE = scopeKeyOf({ runId: 'run-1', callId: 'call-done' })

const openThread = async (): Promise<{ plane: ControlPlane; epoch: number }> => {
  const plane = new ControlPlane({ store: new InMemoryControlStore({ clock: () => AT }) })
  await plane.createSession({
    sessionId: SESSION,
    userId: 'user-1',
    projectId: 'project-1',
    mainThreadId: THREAD,
  })
  const { epoch } = await plane.grant({ sessionId: SESSION, hostId: 1 })
  return { plane, epoch }
}

const appendTo = async (args: {
  plane: ControlPlane
  epoch: number
  bodies: readonly RecordEventBody[]
}): Promise<void> => {
  const from: LogHead = await args.plane.head({ threadId: THREAD })
  const events = chainEvents({
    threadId: THREAD,
    runId: toRunId('run-1'),
    epoch: args.epoch,
    at: AT,
    bodies: args.bodies,
    from,
  })
  const outcome = await args.plane.append({ threadId: THREAD, epoch: args.epoch, events })
  if (!outcome.ok) throw new Error(`append refused: ${JSON.stringify(outcome.refusal)}`)
}

const openCall: RecordEventBody = {
  type: 'tool-dispatched',
  callId: toCallId('call-open'),
  name: 'bash',
}

const doneCall: readonly RecordEventBody[] = [
  { type: 'tool-dispatched', callId: toCallId('call-done'), name: 'bash' },
  { type: 'tool-result', callId: toCallId('call-done'), name: 'bash', output: 'ok' },
]

const recordOf = async (args: {
  plane: ControlPlane
  epoch: number
}): Promise<{ record: StopDebtRecord; appends: FactDraft[][] }> => {
  let cache = await RecordCache.load({ plane: args.plane, threadId: THREAD })
  const appends: FactDraft[][] = []
  return {
    appends,
    record: {
      threadId: THREAD,
      eventCache: () => cache,
      append: async ({ drafts }) => {
        appends.push([...drafts])
        await appendTo({ plane: args.plane, epoch: args.epoch, bodies: drafts })
        cache = await RecordCache.load({ plane: args.plane, threadId: THREAD })
        return []
      },
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

const recordedKinds = (record: StopDebtRecord): readonly string[] =>
  record
    .eventCache()
    .eventsAfter(0)
    .flatMap((event) => (event.type === 'fact-recorded' ? [event.kind] : []))

const until = async (ready: () => boolean): Promise<void> => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (ready()) return
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  throw new Error('the record never caught up with the append')
}

describe('stop debts of a stopped call', () => {
  it('owes the scope of every call dispatched and never answered', async () => {
    const { plane, epoch } = await openThread()
    await appendTo({ plane, epoch, bodies: [openCall, ...doneCall] })
    const { record, appends } = await recordOf({ plane, epoch })

    await oweStoppedCalls({ record, runId: () => toRunId('run-2') })

    expect(appends.flat().map((draft) => draft.key)).toEqual([`stop-owed:${SCOPE_OPEN}`])
    expect(appends.flat().every((draft) => draft.kind === 'stop-owed')).toBe(true)
    expect(SCOPE_OPEN).not.toBe(SCOPE_DONE)
  })

  it('sends cancel-scope for each scope still owed', async () => {
    const { plane, epoch } = await openThread()
    await appendTo({ plane, epoch, bodies: [openCall] })
    const { record } = await recordOf({ plane, epoch })
    await oweStoppedCalls({ record, runId: () => toRunId('run-2') })
    const { calls, sent } = callsOf(CAN)

    payStopDebts(portsOf({ record, calls }))

    expect(sent).toEqual([SCOPE_OPEN])
  })

  it('sends nothing when the daemon cannot cancel a scope', async () => {
    const { plane, epoch } = await openThread()
    await appendTo({ plane, epoch, bodies: [openCall] })
    const { record } = await recordOf({ plane, epoch })
    await oweStoppedCalls({ record, runId: () => toRunId('run-2') })
    const { calls, sent } = callsOf([EDaemonCapability.ExecDeadline])

    payStopDebts(portsOf({ record, calls }))

    expect(sent).toEqual([])
  })

  it('retires the debt when the daemon confirms the scope, so the next holder sends nothing', async () => {
    const { plane, epoch } = await openThread()
    await appendTo({ plane, epoch, bodies: [openCall] })
    const { record, appends } = await recordOf({ plane, epoch })
    await oweStoppedCalls({ record, runId: () => toRunId('run-2') })
    const { calls, sent, confirm } = callsOf(CAN)
    const ports = portsOf({ record, calls })
    watchStopDebts(ports)

    payStopDebts(ports)
    confirm([SCOPE_OPEN])
    await until(() => recordedKinds(record).includes('stop-paid'))
    payStopDebts(ports)

    expect(appends.flat().map((draft) => draft.key)).toEqual([
      `stop-owed:${SCOPE_OPEN}`,
      `stop-paid:${SCOPE_OPEN}`,
    ])
    expect(sent).toEqual([SCOPE_OPEN])
  })

  it('still pays the debt after a summary hid the events around it', async () => {
    const { plane, epoch } = await openThread()
    await appendTo({ plane, epoch, bodies: [openCall] })
    const { record } = await recordOf({ plane, epoch })
    await oweStoppedCalls({ record, runId: () => toRunId('run-2') })
    await appendTo({
      plane,
      epoch,
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
    const { record: reloaded } = await recordOf({ plane, epoch })
    const { calls, sent } = callsOf(CAN)

    payStopDebts(portsOf({ record: reloaded, calls }))

    expect(sent).toEqual([SCOPE_OPEN])
  })
})
