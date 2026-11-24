import { describe, expect, it } from 'bun:test'

import { ControlPlane } from '@dltech/atlas-control'
import { InMemoryControlStore } from '@dltech/atlas-control/testing'
import {
  EInputConsumed,
  EPodResizeProbe,
  POD_RESIZE_SOFT_PROBE_MS,
  toCallId,
  toRunId,
  toThreadId,
  type PodResizeOpen,
} from '@dltech/atlas-core'
import { createInMemoryDaemon, inMemoryDaemonToken } from '@dltech/atlas-protocol/testing'

import { RemoteCalls } from '../../../calls/remote-calls'
import { SessionRecord } from '../record-adapter'

const SESSION = 'session-resize-gate'
const THREAD = toThreadId('thread-resize-gate')
const SANDBOX = 'atlas-v2-record-resize-gate'
const SECRET = 'record-resize-gate-secret'
const AT = '2026-11-08T12:00:00.000Z'
const T0 = Date.parse(AT)

const timers = {
  now: () => T0,
  setTimeout: () => 0,
  clearTimeout: () => {},
  random: () => 0.5,
}

const REASON = 'the pod is being resized to 16 vCPU / 64 GB'

const openAt = (startedAt: number): PodResizeOpen => ({
  generation: 3,
  vcpus: 16,
  memoryGb: 64,
  startedAt,
})

const settleWithin = async (promise: Promise<unknown>): Promise<boolean> => {
  let settled = false
  void promise.then(
    () => {
      settled = true
    },
    () => {
      settled = true
    },
  )
  await new Promise((resolve) => setTimeout(resolve, 100))
  return settled
}

const rigOf = async (args: { probe?: () => Promise<EPodResizeProbe> } = {}) => {
  const plane = new ControlPlane({ store: new InMemoryControlStore({ clock: () => AT }) })
  await plane.createSession({
    sessionId: SESSION,
    userId: 'user-1',
    projectId: 'project-1',
    mainThreadId: THREAD,
  })
  const { epoch } = await plane.grant({ sessionId: SESSION, hostId: 1 })
  const daemon = await createInMemoryDaemon({
    version: 'test',
    sandboxName: SANDBOX,
    secret: SECRET,
  })
  let probes = 0
  const remoteCalls = new RemoteCalls({
    sessionId: SESSION,
    token: inMemoryDaemonToken({ secret: SECRET, sandboxName: SANDBOX }),
    connector: () => Promise.resolve(daemon.connectRaw.bind(daemon) as never),
    timers,
    now: timers.now,
    onFenced: () => {},
    probeResize: async () => {
      probes += 1
      return args.probe === undefined ? EPodResizeProbe.Updating : await args.probe()
    },
  })
  remoteCalls.open({ epoch: 1 })
  await remoteCalls.ready()
  const record = await SessionRecord.open({
    plane,
    threadId: THREAD,
    epoch,
    timers,
    remoteCalls,
    daemonTools: new Set(['bash']),
    nowIso: () => AT,
  })
  return {
    plane,
    record,
    remoteCalls,
    probes: () => probes,
  }
}

const dispatch = (record: SessionRecord, callId: string): Promise<unknown> =>
  record.append({
    threadId: THREAD,
    runId: toRunId('run-1'),
    drafts: [{ type: 'tool-dispatched', callId: toCallId(callId), name: 'bash' }],
  })

const holdCommits = (plane: ControlPlane): (() => void) => {
  const original = plane.append.bind(plane)
  let release = (): void => {}
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  let holding = true
  plane.append = async (args) => {
    if (holding) await held
    return await original(args)
  }
  return () => {
    holding = false
    release()
  }
}

const dispatchedCalls = (record: SessionRecord): string[] =>
  record
    .eventCache()
    .eventsAfter(0)
    .flatMap((event) => (event.type === 'tool-dispatched' ? [event.callId] : []))

const consumed = (record: SessionRecord): Promise<unknown> =>
  record.append({
    threadId: THREAD,
    runId: toRunId('run-1'),
    drafts: [{ type: 'input-consumed', inboxId: 4, consumed: EInputConsumed.Discarded }],
  })

describe('a resize that arms while an append is queued', () => {
  it('backs both queued dispatches out and records nothing until the release', async () => {
    const rig = await rigOf()
    const releaseCommits = holdCommits(rig.plane)
    const first = consumed(rig.record)
    const one = dispatch(rig.record, 'call-queued-1')
    const two = dispatch(rig.record, 'call-queued-2')

    rig.remoteCalls.armResize({ open: openAt(T0), reason: REASON })
    releaseCommits()
    await first

    expect(await settleWithin(one)).toBe(false)
    expect(await settleWithin(two)).toBe(false)
    expect(dispatchedCalls(rig.record)).toEqual([])

    rig.remoteCalls.resizeSettled({ generation: 3 })
    expect(await settleWithin(one)).toBe(true)
    expect(await settleWithin(two)).toBe(true)
    expect(dispatchedCalls(rig.record)).toEqual(['call-queued-1', 'call-queued-2'])
  })

  it('stops the admission wait and records nothing when the turn aborts', async () => {
    const rig = await rigOf()
    rig.remoteCalls.armResize({ open: openAt(T0), reason: REASON })
    const controller = new AbortController()
    let error: unknown
    const gated = rig.record.append({
      threadId: THREAD,
      runId: toRunId('run-1'),
      drafts: [{ type: 'tool-dispatched', callId: toCallId('call-abort'), name: 'bash' }],
      signal: controller.signal,
    })
    void gated.catch((thrown: unknown) => {
      error = thrown
    })
    expect(await settleWithin(gated)).toBe(false)

    controller.abort('stop')
    await settleWithin(gated)

    expect(error).toBeInstanceOf(Error)
    expect(dispatchedCalls(rig.record)).toEqual([])
  })
})

describe('a record append while a resize is open', () => {
  it('holds a daemon dispatch outside the queue and lets other appends through', async () => {
    const rig = await rigOf()
    rig.remoteCalls.armResize({ open: openAt(T0), reason: REASON })

    const dispatchAppend = dispatch(rig.record, 'call-1')
    expect(await settleWithin(dispatchAppend)).toBe(false)

    await consumed(rig.record)
    expect(
      rig.record
        .eventCache()
        .eventsAfter(0)
        .some((event) => event.type === 'input-consumed'),
    ).toBe(true)

    rig.remoteCalls.resizeSettled({ generation: 3 })
    expect(await settleWithin(dispatchAppend)).toBe(true)
  })

  it('keeps holding on an older resize report', async () => {
    const rig = await rigOf()
    rig.remoteCalls.armResize({ open: openAt(T0), reason: REASON })
    const dispatchAppend = dispatch(rig.record, 'call-2')

    rig.remoteCalls.resizeSettled({ generation: 2 })
    expect(await settleWithin(dispatchAppend)).toBe(false)

    rig.remoteCalls.resizeSettled({ generation: 3 })
    expect(await settleWithin(dispatchAppend)).toBe(true)
  })

  it('releases the waiting dispatch on a handoff', async () => {
    const rig = await rigOf()
    rig.remoteCalls.armResize({ open: openAt(T0), reason: REASON })
    const dispatchAppend = dispatch(rig.record, 'call-3')
    expect(await settleWithin(dispatchAppend)).toBe(false)

    rig.remoteCalls.handoff()
    expect(await settleWithin(dispatchAppend)).toBe(true)
  })

  it('releases the waiting dispatch when the holder drains', async () => {
    const rig = await rigOf()
    rig.remoteCalls.armResize({ open: openAt(T0), reason: REASON })
    const dispatchAppend = dispatch(rig.record, 'call-5')
    expect(await settleWithin(dispatchAppend)).toBe(false)

    rig.record.markDraining()
    expect(await settleWithin(dispatchAppend)).toBe(true)
  })

  it('refuses the waiting dispatch when the holder fences', async () => {
    const rig = await rigOf()
    rig.remoteCalls.armResize({ open: openAt(T0), reason: REASON })
    const dispatchAppend = dispatch(rig.record, 'call-6')
    expect(await settleWithin(dispatchAppend)).toBe(false)

    rig.record.fence()
    await expect(dispatchAppend).rejects.toThrow('self-fenced')
  })

  it('probes once when the gate arms on a resize the log already holds', async () => {
    const rig = await rigOf({ probe: async () => EPodResizeProbe.AtTarget })
    rig.remoteCalls.armResize({ open: openAt(T0 - POD_RESIZE_SOFT_PROBE_MS), reason: REASON })

    const dispatchAppend = dispatch(rig.record, 'call-4')
    expect(await settleWithin(dispatchAppend)).toBe(true)
    expect(rig.probes()).toBe(1)
  })
})
