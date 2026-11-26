import { describe, expect, it } from 'bun:test'

import { ControlPlane } from '@dltech/atlas-control'
import { InMemoryControlStore } from '@dltech/atlas-control/testing'
import { toCallId, toRunId, toThreadId } from '@dltech/atlas-core'
import { EDaemonCapability, type CallOp } from '@dltech/atlas-protocol'

import { RemoteCalls } from '../../../calls/remote-calls'
import { fakePod, openCallsOn, until } from '../../../calls/__tests__/fake-pod'
import { TurnAbortedError } from '../append-drafts'
import { SessionRecord } from '../record-adapter'
import { wireStopDebts } from '../../stop-debts'

const SESSION = 'session-1'
const THREAD = toThreadId('thread-1')
const AT = '2026-11-26T12:00:00.000Z'
const sleepOp: CallOp = { op: 'exec', argv: ['/bin/sh', '-c', 'sleep 30'] }

const timers = {
  now: () => Date.parse(AT),
  setTimeout: () => 0,
  clearTimeout: () => {},
  random: () => 0.5,
}

type Gate = {
  hold(): void
  release(): void
  reached(): boolean
}

const gatedPlane = async (): Promise<{ plane: ControlPlane; epoch: number; gate: Gate }> => {
  const plane = new ControlPlane({ store: new InMemoryControlStore({ clock: () => AT }) })
  await plane.createSession({
    sessionId: SESSION,
    userId: 'user-1',
    projectId: 'project-1',
    mainThreadId: THREAD,
  })
  const { epoch } = await plane.grant({ sessionId: SESSION, hostId: 1 })
  const append = plane.append.bind(plane)
  let held = false
  let arrived = false
  const waiting: (() => void)[] = []
  plane.append = async (params) => {
    if (held) {
      arrived = true
      await new Promise<void>((resolve) => waiting.push(resolve))
    }
    return append(params)
  }
  return {
    plane,
    epoch,
    gate: {
      hold: () => {
        held = true
        arrived = false
      },
      release: () => {
        held = false
        for (const resolve of waiting.splice(0)) resolve()
      },
      reached: () => arrived,
    },
  }
}

const remoteCallsOf = (): RemoteCalls =>
  new RemoteCalls({
    sessionId: SESSION,
    token: 'token',
    connector: async () => {
      throw new Error('the record never reaches the sandbox')
    },
    timers,
    onFenced: () => {},
  })

const openRecord = async (args: { plane: ControlPlane; epoch: number }): Promise<SessionRecord> =>
  SessionRecord.open({
    plane: args.plane,
    threadId: THREAD,
    epoch: args.epoch,
    timers,
    remoteCalls: remoteCallsOf(),
    daemonTools: new Set(['bash']),
    nowIso: () => AT,
  })

const callDrafts = (callId: string) => [
  { type: 'tool-called' as const, callId: toCallId(callId), name: 'bash', input: {}, ordinal: 0 },
  {
    type: 'tool-dispatched' as const,
    callId: toCallId(callId),
    name: 'bash',
    bootId: 'boot-a',
  },
]

const factKeysOf = (record: SessionRecord): readonly string[] =>
  record
    .eventCache()
    .eventsAfter(0)
    .flatMap((event) => (event.type === 'fact-recorded' ? [event.key] : []))

describe('the stop debt of a live turn', () => {
  it('owes a dispatch that was still committing when the operator stopped', async () => {
    const { plane, epoch, gate } = await gatedPlane()
    const record = await openRecord({ plane, epoch })
    await record.append({
      threadId: THREAD,
      runId: toRunId('run-1'),
      drafts: callDrafts('call-1'),
    })
    gate.hold()
    const appending = record.append({
      threadId: THREAD,
      runId: toRunId('run-1'),
      drafts: callDrafts('call-2'),
    })
    await until(() => gate.reached())
    const owed = record.oweStoppedTurn({ threadId: THREAD, runId: () => toRunId('run-2') })
    gate.release()
    await Promise.all([appending, owed])

    expect([...factKeysOf(record)].sort()).toEqual(['stop-owed:call-1', 'stop-owed:call-2'])
  })

  it('cancels both stopped scopes on the holder that takes over', async () => {
    const { plane, epoch, gate } = await gatedPlane()
    const record = await openRecord({ plane, epoch })
    await record.append({
      threadId: THREAD,
      runId: toRunId('run-1'),
      drafts: callDrafts('call-1'),
    })
    gate.hold()
    const appending = record.append({
      threadId: THREAD,
      runId: toRunId('run-1'),
      drafts: callDrafts('call-2'),
    })
    await until(() => gate.reached())
    const owed = record.oweStoppedTurn({ threadId: THREAD, runId: () => toRunId('run-2') })
    gate.release()
    await Promise.all([appending, owed])

    const pod = fakePod({ capabilities: [EDaemonCapability.CancelScope] })
    const first = await openCallsOn({ pod, epoch: 1 })
    for (const key of ['call-1.0', 'call-2.0'])
      first.invoke({ key, op: sleepOp }).catch(() => undefined)
    await until(() => pod.daemon.running.size === 2)
    pod.drop()
    first.close()

    wireStopDebts({
      record,
      calls: await openCallsOn({ pod, epoch: 1 }),
      runId: () => toRunId('run-3'),
    })
    await until(() => pod.daemon.running.size === 0)
    await until(() => factKeysOf(record).includes('stop-paid:call-2'))

    expect([...pod.daemon.scopes].sort()).toEqual(['call-1', 'call-2'])
    expect(factKeysOf(record)).toContain('stop-paid:call-1')
    expect(factKeysOf(record)).toContain('stop-paid:call-2')
  })

  it('refuses a dispatch the turn queued after the stop, so the pod never runs it', async () => {
    const { plane, epoch } = await gatedPlane()
    const record = await openRecord({ plane, epoch })
    await record.append({
      threadId: THREAD,
      runId: toRunId('run-1'),
      drafts: callDrafts('call-1'),
    })
    const abort = new AbortController()
    const owed = record.oweStoppedTurn({ threadId: THREAD, runId: () => toRunId('run-2') })
    abort.abort(new TurnAbortedError())
    const rejected = await record
      .append({
        threadId: THREAD,
        runId: toRunId('run-1'),
        drafts: callDrafts('call-2'),
        signal: abort.signal,
      })
      .then(
        () => undefined,
        (error: unknown) => error,
      )
    await owed

    expect(rejected).toBeInstanceOf(TurnAbortedError)
    expect(
      record
        .eventCache()
        .eventsAfter(0)
        .some((event) => event.type === 'tool-dispatched' && event.callId === toCallId('call-2')),
    ).toBe(false)
    expect(factKeysOf(record)).toEqual(['stop-owed:call-1'])
  })
})
