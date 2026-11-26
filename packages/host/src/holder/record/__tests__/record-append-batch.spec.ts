import { describe, expect, it } from 'bun:test'

import { ControlPlane } from '@dltech/atlas-control'
import { InMemoryControlStore } from '@dltech/atlas-control/testing'
import { toCallId, toRunId, toThreadId } from '@dltech/atlas-core'

import { RemoteCalls } from '../../../calls/remote-calls'
import { SessionRecord } from '../record-adapter'

const SESSION = 'session-1'
const THREAD = toThreadId('thread-1')
const AT = '2026-11-08T12:00:00.000Z'

const timers = {
  now: () => Date.parse(AT),
  setTimeout: () => 0,
  clearTimeout: () => {},
  random: () => 0.5,
}

type CountedPlane = {
  plane: ControlPlane
  epoch: number
  calls: { events: readonly unknown[] }[]
}

const countedPlane = async (): Promise<CountedPlane> => {
  const plane = new ControlPlane({ store: new InMemoryControlStore({ clock: () => AT }) })
  await plane.createSession({
    sessionId: SESSION,
    userId: 'user-1',
    projectId: 'project-1',
    mainThreadId: THREAD,
  })
  const { epoch } = await plane.grant({ sessionId: SESSION, hostId: 1 })
  const calls: { events: readonly unknown[] }[] = []
  const append = plane.append.bind(plane)
  plane.append = async (params) => {
    calls.push({ events: params.events })
    return append(params)
  }
  return { plane, epoch, calls }
}

const remoteCallsOf = (acked?: string[]): RemoteCalls => {
  const remoteCalls = new RemoteCalls({
    sessionId: SESSION,
    token: 'token',
    connector: async () => {
      throw new Error('the probe append never reaches the sandbox')
    },
    timers,
    onFenced: () => {},
  })
  if (acked !== undefined) {
    remoteCalls.ackScope = async (args) => {
      acked.push(args.scopeKey)
    }
  }
  return remoteCalls
}

const openRecord = async (args: {
  plane: ControlPlane
  epoch: number
  daemonTools?: ReadonlySet<string>
  acked?: string[]
}): Promise<SessionRecord> =>
  SessionRecord.open({
    plane: args.plane,
    threadId: THREAD,
    epoch: args.epoch,
    timers,
    remoteCalls: remoteCallsOf(args.acked),
    daemonTools: args.daemonTools ?? new Set<string>(),
    nowIso: () => AT,
  })

describe('SessionRecord one commit per append', () => {
  it('commits three drafts in a single plane.append with contiguous seqs', async () => {
    const { plane, epoch, calls } = await countedPlane()
    const record = await openRecord({ plane, epoch })

    await record.append({
      threadId: THREAD,
      runId: toRunId('run-1'),
      drafts: [
        { type: 'assistant-said', parts: [{ type: 'text', text: 'working on it' }] },
        { type: 'tool-dispatched', callId: toCallId('call-1'), name: 'read' },
        { type: 'tool-result', callId: toCallId('call-1'), name: 'read', output: { ok: true } },
      ],
    })

    expect(calls.length).toBe(1)
    expect(calls[0]?.events.length).toBe(3)
    const events = record.eventCache().eventsAfter(0)
    expect(events.map((event) => event.type)).toEqual([
      'assistant-said',
      'tool-dispatched',
      'tool-result',
    ])
    expect(events.map((event) => event.seq)).toEqual([1, 2, 3])
  })

  it('commits an input-posted and the user-said that consumes it in the same call', async () => {
    const { plane, epoch, calls } = await countedPlane()
    const record = await openRecord({ plane, epoch })

    await record.append({
      threadId: THREAD,
      runId: toRunId('run-1'),
      drafts: [
        { type: 'input-posted', inboxId: 3, kind: 'message', postedAt: AT, text: 'hello' },
        { type: 'user-said', text: 'hello', inboxId: 3 },
      ],
    })

    expect(calls.length).toBe(1)
    expect(calls[0]?.events.length).toBe(2)
    expect(
      record
        .eventCache()
        .eventsAfter(0)
        .map((event) => event.type),
    ).toEqual(['input-posted', 'user-said'])
  })

  it('makes no plane.append call when every draft is dropped', async () => {
    const { plane, epoch, calls } = await countedPlane()
    const record = await openRecord({ plane, epoch })

    const events = await record.append({
      threadId: THREAD,
      runId: toRunId('run-1'),
      drafts: [],
    })

    expect(events).toEqual([])
    expect(calls.length).toBe(0)
  })
})

describe('SessionRecord daemon acks', () => {
  it('acks every daemon tool-result scope after the single commit', async () => {
    const { plane, epoch, calls } = await countedPlane()
    const acked: string[] = []
    const record = await openRecord({
      plane,
      epoch,
      daemonTools: new Set(['bash', 'read']),
      acked,
    })

    await record.append({
      threadId: THREAD,
      runId: toRunId('run-1'),
      drafts: [
        { type: 'tool-result', callId: toCallId('call-1'), name: 'bash', output: { ok: true } },
        { type: 'tool-result', callId: toCallId('call-2'), name: 'read', output: { ok: true } },
        { type: 'tool-result', callId: toCallId('call-3'), name: 'write', output: { ok: true } },
      ],
    })

    expect(calls.length).toBe(1)
    expect(acked).toEqual(['call-1', 'call-2'])
  })
})
