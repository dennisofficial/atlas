import { ControlPlane } from '@dltech/atlas-control'
import { InMemoryControlStore } from '@dltech/atlas-control/testing'
import {
  chainEvents,
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
import type {
  FactDraft,
  StopDebtCalls,
  StopDebtPorts,
  StopDebtRecord,
  StopDebtSource,
} from '../stop-debts'

export const SESSION = 'session-1'
export const THREAD = toThreadId('thread-1')
export const CHILD = toThreadId('thread-2')
export const AT = '2026-11-26T12:00:00.000Z'
export const SCOPE_OPEN = scopeKeyOf({ runId: 'run-1', callId: 'call-open' })
export const SCOPE_CHILD = scopeKeyOf({ runId: 'run-1', callId: 'call-child' })
export const CAN = [EDaemonCapability.CancelScope]

export type MemoryRecord = StopDebtRecord &
  StopDebtSource & {
    appends: FactDraft[][]
    enqueue(bodies: readonly RecordEventBody[]): Promise<void>
  }

export type Gate = {
  hold(): void
  release(): void
  reached(): boolean
  untilReleased(): Promise<void>
}

export const gateOf = (): Gate => {
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

export const openThread = async (): Promise<{ plane: ControlPlane; epoch: number }> => {
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

export const appendTo = async (args: {
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

export const owedFact = (scope: string): FactDraft => ({
  type: 'fact-recorded',
  key: `stop-owed:${scope}`,
  kind: 'stop-owed',
})

export const openCall = (callId: string): readonly RecordEventBody[] => [
  { type: 'tool-called', callId: toCallId(callId), name: 'bash', input: {}, ordinal: 0 },
  { type: 'tool-dispatched', callId: toCallId(callId), name: 'bash' },
]

export const recordOf = async (args: {
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
      await args.gate?.untilReleased()
      await appendTo({
        plane: args.plane,
        epoch: args.epoch,
        threadId: next.threadId,
        bodies: next.bodies,
        runId: next.runId,
      })
      cache = await RecordCache.load({ plane: args.plane, threadId: args.threadId })
    })
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

export const callsOf = (capabilities: readonly string[]) => {
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

export const portsOf = (args: { record: StopDebtRecord; calls: StopDebtCalls }): StopDebtPorts => ({
  ...args,
  runId: () => toRunId('run-2'),
})

export const factKeysOf = (record: StopDebtRecord): readonly string[] =>
  record
    .eventCache()
    .eventsAfter(0)
    .flatMap((event) => (event.type === 'fact-recorded' ? [event.key] : []))

export const until = async (ready: () => boolean): Promise<void> => {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    if (ready()) return
    await new Promise((resolve) => setTimeout(resolve, 1))
  }
  throw new Error('the record never caught up with the append')
}
