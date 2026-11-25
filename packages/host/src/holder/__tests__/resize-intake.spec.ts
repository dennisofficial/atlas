import { describe, expect, it } from 'bun:test'

import { ControlPlane } from '@dltech/atlas-control'
import { InMemoryControlStore } from '@dltech/atlas-control/testing'
import {
  EPodResizeNotice,
  inboxEventPayloadOf,
  INBOX_KIND_RECORD,
  toRunId,
  toThreadId,
} from '@dltech/atlas-core'

import { RemoteCalls } from '../../calls/remote-calls'
import { handleResizeEntries, reconcileResizeGate } from '../held-resize'
import { InboxIntake } from '../inbox-intake'
import { EIntakeScope } from '../intake-scope'
import { SessionRecord } from '../record/record-adapter'

const SESSION = 'session-resize-intake'
const THREAD = toThreadId('thread-resize-intake')
const AT = '2026-11-24T12:00:00.000Z'
const T0 = Date.parse(AT)

const timers = {
  now: () => T0,
  setTimeout: () => 0,
  clearTimeout: () => {},
  random: () => 0.5,
}

const SHAPE = { vcpus: 16, memoryGb: 64, generation: 3 }

const rigOf = async () => {
  const plane = new ControlPlane({ store: new InMemoryControlStore({ clock: () => AT }) })
  await plane.createSession({
    sessionId: SESSION,
    userId: 'user-1',
    projectId: 'project-1',
    mainThreadId: THREAD,
  })
  const { epoch } = await plane.grant({ sessionId: SESSION, hostId: 1 })
  const remoteCalls = new RemoteCalls({
    sessionId: SESSION,
    token: 'unused',
    connector: () => Promise.reject(new Error('this rig never connects to a daemon')),
    timers,
    now: timers.now,
    onFenced: () => {},
  })
  const record = await SessionRecord.open({
    plane,
    threadId: THREAD,
    epoch,
    timers,
    remoteCalls,
    daemonTools: new Set(['bash']),
    nowIso: () => AT,
  })
  const intake = new InboxIntake({
    plane,
    sessionId: SESSION,
    record,
    threadId: THREAD,
    runId: () => toRunId('run-intake'),
    scope: EIntakeScope.Main,
  })
  const post = async (event: { type: string } & Record<string, unknown>): Promise<number> => {
    const posted = await plane.post({
      sessionId: SESSION,
      kind: INBOX_KIND_RECORD,
      payload: inboxEventPayloadOf({ event: event as never }),
    })
    return posted.inboxId
  }
  const inbox = () => plane.readInbox({ sessionId: SESSION, afterId: 0, limit: 100 })
  return { plane, record, remoteCalls, intake, post, inbox }
}

const logTypes = (record: SessionRecord): string[] =>
  record
    .eventCache()
    .eventsAfter(0)
    .map((event) => event.type)

describe('a resize record that arrives while the intake drains', () => {
  it('leaves both records to the held lap, which interrupts and settles them', async () => {
    const rig = await rigOf()
    const startedId = await rig.post({ type: 'pod-resize-started', ...SHAPE })
    const resizedId = await rig.post({
      type: 'pod-resized',
      ...SHAPE,
      outcome: EPodResizeNotice.Applied,
    })

    await rig.intake.prepare()

    expect((await rig.inbox()).map((entry) => entry.inboxId)).toEqual([startedId, resizedId])
    expect(logTypes(rig.record)).toEqual([])

    const entries = await rig.inbox()
    const calls = rig.remoteCalls
    const handled = await handleResizeEntries({
      entries: entries.filter((entry) => entry.inboxId === startedId),
      record: rig.record,
      calls,
      runId: () => toRunId('run-resize'),
    })

    expect(handled).toBe(true)
    expect(calls.resizeReason()).toBe('the pod is being resized to 16 vCPU / 64 GB')
    expect(calls.resizeHeld()).toMatchObject({ generation: 3 })

    await handleResizeEntries({
      entries: entries.filter((entry) => entry.inboxId === resizedId),
      record: rig.record,
      calls,
      runId: () => toRunId('run-resize'),
    })

    expect(calls.resizeHeld()).toBeUndefined()
    expect(await rig.inbox()).toEqual([])
    expect(logTypes(rig.record)).toContain('pod-resize-started')
    expect(logTypes(rig.record)).toContain('pod-resized')
  })

  it('hands a resize record the lap had not read yet back to the lap instead of posting it', async () => {
    const rig = await rigOf()
    const resizedId = await rig.post({
      type: 'pod-resized',
      ...SHAPE,
      outcome: EPodResizeNotice.Applied,
    })

    const staged = await rig.intake.logStaged({ prepared: () => true })

    expect(staged?.map((entry) => entry.inboxId)).toEqual([resizedId])
    expect(logTypes(rig.record)).toEqual([])
    expect((await rig.inbox()).map((entry) => entry.inboxId)).toEqual([resizedId])
  })

  it('releases an armed gate whose resize notice the log carries only as a posting', async () => {
    const rig = await rigOf()
    await rig.record.append({
      threadId: THREAD,
      runId: toRunId('run-log'),
      drafts: [{ type: 'pod-resize-started', ...SHAPE }],
    })
    rig.remoteCalls.armResize({
      open: { ...SHAPE, startedAt: T0 },
      reason: 'the pod is being resized to 16 vCPU / 64 GB',
    })
    const resizedId = await rig.post({
      type: 'pod-resized',
      ...SHAPE,
      outcome: EPodResizeNotice.Applied,
    })
    await rig.record.append({
      threadId: THREAD,
      runId: toRunId('run-post'),
      drafts: [
        {
          type: 'input-posted',
          inboxId: resizedId,
          kind: INBOX_KIND_RECORD,
          postedAt: AT,
          event: { type: 'pod-resized', ...SHAPE, outcome: EPodResizeNotice.Applied },
        },
      ],
    })
    expect(rig.remoteCalls.resizeHeld()).toMatchObject({ generation: 3 })
    expect(await rig.inbox()).toEqual([])

    reconcileResizeGate({ record: rig.record, runtime: { remoteCalls: rig.remoteCalls } })

    expect(rig.remoteCalls.resizeHeld()).toBeUndefined()
  })

  it('releases an armed gate whose generation the log already reports as resized', async () => {
    const rig = await rigOf()
    await rig.record.append({
      threadId: THREAD,
      runId: toRunId('run-log'),
      drafts: [
        { type: 'pod-resize-started', ...SHAPE },
        { type: 'pod-resized', ...SHAPE, outcome: EPodResizeNotice.Applied },
      ],
    })
    rig.remoteCalls.armResize({
      open: { ...SHAPE, startedAt: T0 },
      reason: 'the pod is being resized to 16 vCPU / 64 GB',
    })
    expect(rig.remoteCalls.resizeHeld()).toBeDefined()

    reconcileResizeGate({ record: rig.record, runtime: { remoteCalls: rig.remoteCalls } })

    expect(rig.remoteCalls.resizeHeld()).toBeUndefined()
  })
})
