import { describe, expect, it } from 'bun:test'

import {
  chainEvents,
  chainHash,
  toCallId,
  toRunId,
  toThreadId,
  type LogHead,
  type RecordEvent,
  type RecordEventBody,
} from '@dltech/atlas-core'
import { EDaemonCapability, type CallOp } from '@dltech/atlas-protocol'

import {
  oweStoppedCalls,
  wireStopDebts,
  type FactDraft,
  type StopDebtRecord,
} from '../../holder/stop-debts'
import { fakePod, openCallsOn, until } from './fake-pod'

const THREAD = toThreadId('thread-1')
const AT = '2026-11-26T12:00:00.000Z'

const sleepOp: CallOp = { op: 'exec', argv: ['/bin/sh', '-c', 'sleep 30'] }

const dispatchOf = (callId: string): RecordEventBody => ({
  type: 'tool-dispatched',
  callId: toCallId(callId),
  name: 'bash',
})

const memoryRecord = (): {
  record: StopDebtRecord
  appends: FactDraft[][]
  append(bodies: readonly RecordEventBody[]): Promise<void>
} => {
  let events: RecordEvent[] = []
  const appends: FactDraft[][] = []
  const append = async (bodies: readonly RecordEventBody[]): Promise<void> => {
    const last = events[events.length - 1]
    const from: LogHead | undefined =
      last === undefined ? undefined : { seq: last.seq, hash: chainHash(last) }
    events = [
      ...events,
      ...chainEvents({
        threadId: THREAD,
        runId: toRunId('run-1'),
        epoch: 1,
        at: AT,
        bodies,
        ...(from === undefined ? {} : { from }),
      }),
    ]
  }
  return {
    appends,
    append,
    record: {
      threadId: THREAD,
      eventCache: () => ({ eventsAfter: () => [...events], resolvedEvent: (event) => event }),
      append: async ({ drafts }) => {
        appends.push([...drafts])
        await append(drafts)
        return []
      },
    },
  }
}

const stopWhileRunning = async (args: {
  pod: ReturnType<typeof fakePod>
  record: StopDebtRecord
}): Promise<void> => {
  const first = await openCallsOn({ pod: args.pod, epoch: 1 })
  const running = first.invoke({ key: 's.0', op: sleepOp })
  running.catch(() => undefined)
  await until(() => args.pod.daemon.running.has('s.0'))
  args.pod.drop()
  first.close()
  await oweStoppedCalls({ record: args.record, runId: () => toRunId('run-1') })
}

const settle = async (): Promise<void> => {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

describe('a stopped call across holders', () => {
  it('cancels the pod work the stopped call left behind, on the holder that takes over', async () => {
    const pod = fakePod({ capabilities: [EDaemonCapability.CancelScope] })
    const { record, appends, append } = memoryRecord()
    await append([dispatchOf('s')])
    await stopWhileRunning({ pod, record })
    expect(pod.daemon.running.has('s.0')).toBe(true)

    const ports = {
      record,
      calls: await openCallsOn({ pod, epoch: 1 }),
      runId: () => toRunId('run-1'),
    }
    wireStopDebts(ports)
    await until(() => appends.some((drafts) => drafts.some((draft) => draft.kind === 'stop-paid')))

    expect(pod.daemon.scopes).toEqual(['s'])
    expect(pod.daemon.running.has('s.0')).toBe(false)
    expect(appends.map((drafts) => drafts.map((draft) => draft.key))).toEqual([
      ['stop-owed:s'],
      ['stop-paid:s'],
    ])
  })

  it('leaves the debt owing when the daemon cannot cancel a scope', async () => {
    const pod = fakePod({ capabilities: [EDaemonCapability.ExecDeadline] })
    const { record, appends, append } = memoryRecord()
    await append([dispatchOf('s')])
    await stopWhileRunning({ pod, record })

    const ports = {
      record,
      calls: await openCallsOn({ pod, epoch: 1 }),
      runId: () => toRunId('run-1'),
    }
    wireStopDebts(ports)
    await settle()

    expect(pod.daemon.scopes).toEqual([])
    expect(pod.daemon.running.has('s.0')).toBe(true)
    expect(appends.map((drafts) => drafts.map((draft) => draft.kind))).toEqual([['stop-owed']])
  })
})
