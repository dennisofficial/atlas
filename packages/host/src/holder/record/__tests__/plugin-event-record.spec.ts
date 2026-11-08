import { describe, expect, it } from 'bun:test'
import { z } from 'zod'

import { ControlPlane } from '@dltech/atlas-control'
import { InMemoryControlStore } from '@dltech/atlas-control/testing'
import { createV2EventSchema, toRunId, toThreadId } from '@dltech/atlas-core'

import { RemoteCalls } from '../../../calls/remote-calls'
import { SessionRecord } from '../record-adapter'

declare module '@dltech/atlas-core' {
  interface PluginEventBodies {
    'probe-observed': { type: 'probe-observed'; label: string }
  }
}

const probeObservedSchema = z.object({
  type: z.literal('probe-observed'),
  label: z.string().min(1),
})

const SESSION = 'session-1'
const THREAD = toThreadId('thread-1')
const AT = '2026-11-08T12:00:00.000Z'

const timers = {
  now: () => Date.parse(AT),
  setTimeout: () => 0,
  clearTimeout: () => {},
  random: () => 0.5,
}

const composedPlane = async (): Promise<{ plane: ControlPlane; epoch: number }> => {
  const plane = new ControlPlane({
    store: new InMemoryControlStore({ clock: () => AT }),
    eventSchema: createV2EventSchema({ pluginBodies: [probeObservedSchema] }),
  })
  await plane.createSession({
    sessionId: SESSION,
    userId: 'user-1',
    projectId: 'project-1',
    mainThreadId: THREAD,
  })
  const { epoch } = await plane.grant({ sessionId: SESSION, hostId: 1 })
  return { plane, epoch }
}

const remoteCallsOf = (): RemoteCalls =>
  new RemoteCalls({
    sessionId: SESSION,
    token: 'token',
    connector: async () => {
      throw new Error('the probe event never reaches the sandbox')
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
    daemonTools: new Set<string>(),
    nowIso: () => AT,
  })

describe('a plugin event through the host record', () => {
  it('is appended and read back when the plane composes the plugin schema', async () => {
    const { plane, epoch } = await composedPlane()
    const record = await openRecord({ plane, epoch })
    await record.append({
      threadId: THREAD,
      runId: toRunId('run-1'),
      drafts: [{ type: 'probe-observed', label: 'first' }],
    })

    const reopened = await openRecord({ plane, epoch })
    const events = reopened.eventCache().eventsAfter(0)
    expect(events.map((event) => event.type)).toEqual(['probe-observed'])
    expect(events[0]).toMatchObject({ label: 'first', seq: 1 })
  })

  it('is refused by a plane built with core alone', async () => {
    const plane = new ControlPlane({
      store: new InMemoryControlStore({ clock: () => AT }),
    })
    await plane.createSession({
      sessionId: SESSION,
      userId: 'user-1',
      projectId: 'project-1',
      mainThreadId: THREAD,
    })
    const { epoch } = await plane.grant({ sessionId: SESSION, hostId: 1 })
    const record = await openRecord({ plane, epoch })
    await expect(
      record.append({
        threadId: THREAD,
        runId: toRunId('run-1'),
        drafts: [{ type: 'probe-observed', label: 'first' }],
      }),
    ).rejects.toThrow('append refused')
  })
})
