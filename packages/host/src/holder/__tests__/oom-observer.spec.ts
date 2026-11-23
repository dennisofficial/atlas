import { describe, expect, it } from 'bun:test'

import {
  EOomScope,
  toRunId,
  toThreadId,
  type EventDraft,
  type RunId,
  type ThreadId,
} from '@dltech/atlas-core'
import {
  ECallStatus,
  type CallOp,
  type CallResult,
  type OomIncident,
  type PodOomEvent,
} from '@dltech/atlas-protocol'

import type { EventFrame } from '../../calls/remote-calls'
import { OomObserver } from '../oom-observer'

const THREAD = toThreadId('thread-main')
const RUN = toRunId('run-1')

const MEMORY = { commandLimitBytes: 2_490_195_968, podBytes: 4_100_808_704 }

const COMMAND_INCIDENT: OomIncident = {
  incidentId: 'oom-1',
  at: 1,
  scope: EOomScope.Command,
  command: 'bunx turbo run typecheck',
  processes: 1,
  memory: MEMORY,
}

const UNOWNED_INCIDENT: OomIncident = {
  incidentId: 'oom-2',
  at: 2,
  scope: EOomScope.Pod,
  processes: 2,
  memory: MEMORY,
}

class FakeCalls {
  readonly listeners = new Set<(frame: EventFrame) => void>()
  readonly acked: string[] = []
  readonly ops: CallOp[] = []
  listed: readonly OomIncident[] = []

  onEvent(listener: (frame: EventFrame) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  invoke(args: { key: string; op: CallOp }): Promise<CallResult> {
    this.ops.push(args.op)
    if (args.op.op !== 'oom.list') throw new Error(`unexpected op ${args.op.op}`)
    return Promise.resolve({
      status: ECallStatus.Ok,
      op: 'oom.list',
      value: { incidents: [...this.listed] },
    })
  }

  ack(args: { key: string }): Promise<void> {
    this.acked.push(args.key)
    return Promise.resolve()
  }

  emit(event: PodOomEvent): void {
    for (const listener of [...this.listeners]) listener({ kind: 'event', event })
  }
}

class FakeRecorder {
  readonly appended: EventDraft[] = []

  constructor(private readonly known: readonly string[] = []) {}

  append(args: {
    threadId: ThreadId
    runId: RunId
    drafts: readonly EventDraft[]
  }): Promise<unknown> {
    expect(args.threadId).toBe(THREAD)
    expect(args.runId).toBe(RUN)
    this.appended.push(...args.drafts)
    return Promise.resolve()
  }

  recorded(incidentId: string): boolean {
    return (
      this.known.includes(incidentId) ||
      this.appended.some(
        (draft) => draft.type === 'pod-ran-out-of-memory' && draft.incidentId === incidentId,
      )
    )
  }
}

const observerFor = (args: { calls: FakeCalls; record: FakeRecorder }): OomObserver =>
  new OomObserver({
    record: args.record,
    remoteCalls: args.calls,
    threadId: THREAD,
    runId: () => RUN,
    signal: new AbortController().signal,
  })

const incidentsOf = (record: FakeRecorder) =>
  record.appended.flatMap((draft) => (draft.type === 'pod-ran-out-of-memory' ? [draft] : []))

describe('recording pod out-of-memory incidents', () => {
  it('records a pod OOM incident once in the session log', async () => {
    const calls = new FakeCalls()
    calls.listed = [COMMAND_INCIDENT]
    const record = new FakeRecorder()
    const observer = observerFor({ calls, record })

    observer.start()
    calls.emit({ type: 'pod.oom', incident: COMMAND_INCIDENT })
    calls.emit({ type: 'pod.oom', incident: COMMAND_INCIDENT })
    await observer.settled()

    expect(incidentsOf(record)).toEqual([
      {
        type: 'pod-ran-out-of-memory',
        incidentId: 'oom-1',
        scope: EOomScope.Command,
        command: 'bunx turbo run typecheck',
        processes: 1,
        memory: MEMORY,
      },
    ])
    expect(calls.acked).toHaveLength(1)
    expect(calls.ops.map((op) => op.op)).toEqual(['oom.list'])
  })

  it('records an OOM kill no command owns as a pod incident', async () => {
    const calls = new FakeCalls()
    calls.listed = [UNOWNED_INCIDENT]
    const record = new FakeRecorder()

    const observer = observerFor({ calls, record })
    observer.start()
    await observer.settled()

    expect(incidentsOf(record)).toEqual([
      {
        type: 'pod-ran-out-of-memory',
        incidentId: 'oom-2',
        scope: EOomScope.Pod,
        processes: 2,
        memory: MEMORY,
      },
    ])
  })

  it('skips an incident the session log already holds', async () => {
    const calls = new FakeCalls()
    calls.listed = [COMMAND_INCIDENT]
    const record = new FakeRecorder(['oom-1'])
    const observer = observerFor({ calls, record })

    observer.start()
    calls.emit({ type: 'pod.oom', incident: COMMAND_INCIDENT })
    await observer.settled()

    expect(incidentsOf(record)).toEqual([])
  })

  it('stops recording after a stop', async () => {
    const calls = new FakeCalls()
    const record = new FakeRecorder()
    const observer = observerFor({ calls, record })

    observer.start()
    await observer.settled()
    observer.stop()
    calls.emit({ type: 'pod.oom', incident: COMMAND_INCIDENT })
    await observer.settled()

    expect(incidentsOf(record)).toEqual([])
  })
})
