import { describe, expect, it } from 'bun:test'

import { ControlPlane } from '@dltech/atlas-control'
import { InMemoryControlStore } from '@dltech/atlas-control/testing'
import { toCallId, toRunId, toThreadId } from '@dltech/atlas-core'
import { createInMemoryDaemon, inMemoryDaemonToken } from '@dltech/atlas-protocol/testing'

import { runInCallScope, scopeDispatchedBootId } from '../../../calls/call-scope'
import { RemoteCalls } from '../../../calls/remote-calls'
import { dispatchBootOf, type DispatchBootLink } from '../record-commit'
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

const fakeLink = (args: {
  boot: string | undefined
  linked: boolean
  onReady?: (() => string) | undefined
}): { link: DispatchBootLink; readies: () => number } => {
  const state = { boot: args.boot, linked: args.linked, readies: 0 }
  const link: DispatchBootLink = {
    linked: () => state.linked,
    bootId: () => state.boot,
    ready: async () => {
      state.readies += 1
      if (args.onReady === undefined) throw new Error('this dispatch must not wait for the link')
      state.boot = args.onReady()
      state.linked = true
      return { bootId: state.boot, version: 'test' }
    },
  }
  return { link, readies: () => state.readies }
}

const draftOf = (args: { name: string; callId: string; bootId?: string | undefined }) => ({
  type: 'tool-dispatched' as const,
  callId: toCallId(args.callId),
  name: args.name,
  ...(args.bootId === undefined ? {} : { bootId: args.bootId }),
})

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

  it('waits for the pod to answer before it records the boot of a tool the daemon runs', async () => {
    const link = fakeLink({ boot: 'boot-a', linked: false, onReady: () => 'boot-b' })

    const event = await dispatchBootOf({
      draft: draftOf({ name: 'bash', callId: 'call-bash' }),
      daemonTools: new Set(['bash']),
      link: link.link,
    })

    expect(event).toBe('boot-b')
    expect(link.readies()).toBe(1)
  })

  it('records the boot the link last saw for a tool the daemon does not run, without waiting', async () => {
    const link = fakeLink({ boot: 'boot-a', linked: true })

    const event = await dispatchBootOf({
      draft: draftOf({ name: 'service', callId: 'call-service' }),
      daemonTools: new Set(['bash']),
      link: link.link,
    })

    expect(event).toBe('boot-a')
    expect(link.readies()).toBe(0)
  })

  it('records nothing from the cached boot of a dropped link, and the new boot once it answers', async () => {
    const link = fakeLink({ boot: 'boot-a', linked: false, onReady: () => 'boot-b' })

    const event = await dispatchBootOf({
      draft: draftOf({ name: 'bash', callId: 'call-bash' }),
      daemonTools: new Set(['bash']),
      link: link.link,
    })

    expect(event).toBe('boot-b')
  })

  it('records nothing for a tool the daemon does not run while the link is down', async () => {
    const link = fakeLink({ boot: 'boot-a', linked: false })

    const event = await dispatchBootOf({
      draft: draftOf({ name: 'service', callId: 'call-service' }),
      daemonTools: new Set(['bash']),
      link: link.link,
    })

    expect(event).toBeUndefined()
    expect(link.readies()).toBe(0)
  })

  it('keeps the boot the draft already carries', async () => {
    const link = fakeLink({ boot: 'boot-link', linked: true })

    const event = await dispatchBootOf({
      draft: draftOf({ name: 'service', callId: 'call-carried', bootId: 'boot-draft' }),
      daemonTools: new Set(['bash']),
      link: link.link,
    })

    expect(event).toBe('boot-draft')
  })
})

describe('the call scope of a recorded dispatch', () => {
  const scopeOf = async (name: string): Promise<string | undefined> => {
    const rig = await rigOf({ connected: true })
    let seen: string | undefined
    await runInCallScope({
      scopeKey: `run-1:${name}`,
      body: async () => {
        await dispatch({ record: rig.record, name, callId: `call-${name}` })
        seen = scopeDispatchedBootId()
      },
    })
    expect(dispatchOf(rig.record)[0]?.bootId).toBe(rig.remoteCalls.bootId())
    rig.remoteCalls.close()
    await rig.daemon.stop()
    return seen
  }

  it('hands the recorded boot to a tool the daemon runs', async () => {
    const seen = await scopeOf('bash')
    expect(typeof seen).toBe('string')
  })

  it('hands no boot to a tool the daemon does not run', async () => {
    expect(await scopeOf('service')).toBeUndefined()
  })
})
