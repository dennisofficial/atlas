import { describe, expect, it } from 'bun:test'

import { ControlPlane } from '@dltech/atlas-control'
import { InMemoryControlStore } from '@dltech/atlas-control/testing'
import { toCallId, toRunId, toThreadId } from '@dltech/atlas-core'
import { createInMemoryDaemon, inMemoryDaemonToken } from '@dltech/atlas-protocol/testing'

import { RemoteCalls } from '../../../calls/remote-calls'
import { SessionRecord } from '../record-adapter'

const SESSION = 'session-dispatch-boot'
const THREAD = toThreadId('thread-dispatch-boot')
const SANDBOX = 'atlas-v2-record-dispatch-boot'
const SECRET = 'record-dispatch-boot-secret'
const AT = '2026-11-08T12:00:00.000Z'

const timers = {
  now: () => Date.parse(AT),
  setTimeout: () => 0,
  clearTimeout: () => {},
  random: () => 0.5,
}

const rigOf = async (args: { connected: boolean }) => {
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
  const remoteCalls = new RemoteCalls({
    sessionId: SESSION,
    token: inMemoryDaemonToken({ secret: SECRET, sandboxName: SANDBOX }),
    connector: () => Promise.resolve(daemon.connectRaw.bind(daemon) as never),
    timers,
    now: timers.now,
    onFenced: () => {},
  })
  if (args.connected) {
    remoteCalls.open({ epoch: 1 })
    await remoteCalls.ready()
  }
  const record = await SessionRecord.open({
    plane,
    threadId: THREAD,
    epoch,
    timers,
    remoteCalls,
    daemonTools: new Set(['bash']),
    nowIso: () => AT,
  })
  return { record, remoteCalls, daemon }
}

const dispatch = (args: {
  record: SessionRecord
  name: string
  callId: string
}): Promise<unknown> =>
  args.record.append({
    threadId: THREAD,
    runId: toRunId('run-1'),
    drafts: [{ type: 'tool-dispatched', callId: toCallId(args.callId), name: args.name }],
  })

const dispatchOf = (record: SessionRecord) =>
  record
    .eventCache()
    .eventsAfter(0)
    .flatMap((event) => (event.type === 'tool-dispatched' ? [event] : []))

describe('the boot a dispatch is recorded under', () => {
  it('records the pod boot for a tool the daemon does not run', async () => {
    const rig = await rigOf({ connected: true })
    await dispatch({ record: rig.record, name: 'service', callId: 'call-service' })

    const [event] = dispatchOf(rig.record)
    expect(event?.bootId).toBe(rig.remoteCalls.bootId())
    expect(typeof event?.bootId).toBe('string')

    rig.remoteCalls.close()
    await rig.daemon.stop()
  })

  it('records a dispatch with no boot when the link has none, and does not fail it', async () => {
    const rig = await rigOf({ connected: false })
    await dispatch({ record: rig.record, name: 'service', callId: 'call-offline' })

    const [event] = dispatchOf(rig.record)
    expect(event).toBeDefined()
    expect(event?.bootId ?? undefined).toBeUndefined()

    rig.remoteCalls.close()
    await rig.daemon.stop()
  })
})
