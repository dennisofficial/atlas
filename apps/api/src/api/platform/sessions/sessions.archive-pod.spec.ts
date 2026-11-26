import { describe, expect, it } from 'bun:test'
import {
  chainEvents,
  ETurnCause,
  INBOX_KIND_STOP,
  toRunId,
  toThreadId,
  type RecordEventBody,
} from '@dltech/atlas-core'

import {
  FakePodResizeDispatcher,
  NOW,
  setupSessionsService as setup,
} from './sessions.service.fixture'

type Rig = ReturnType<typeof setup>

const appendAsHolder = async (args: {
  plane: Rig['plane']
  sessionId: string
  threadId: string
  bodies: RecordEventBody[]
}): Promise<void> => {
  const granted = await args.plane.grant({ sessionId: args.sessionId, hostId: 9000 })
  const appended = await args.plane.append({
    threadId: args.threadId,
    epoch: granted.epoch,
    events: chainEvents({
      threadId: toThreadId(args.threadId),
      runId: toRunId('run-1'),
      epoch: granted.epoch,
      at: NOW,
      bodies: args.bodies,
    }),
  })
  if (!appended.ok) throw new Error('the append was refused')
}

const inboxKindsOf = async (args: { plane: Rig['plane']; sessionId: string }) =>
  (await args.plane.readInbox({ sessionId: args.sessionId, afterId: 0, limit: 20 })).map(
    (entry) => entry.kind,
  )

const archive = (args: { service: Rig['service']; sessionId: string; archived: boolean }) =>
  args.service.archive({ userId: 'user-a', sessionId: args.sessionId, archived: args.archived })

describe('SessionsService.archive parks the pod', () => {
  it('sleeps the pod of an idle session without posting a stop', async () => {
    const { plane, service, dispatcher } = setup()
    const created = await service.create({ userId: 'user-a', projectId: 'proj-a' })
    await appendAsHolder({
      plane,
      sessionId: created.sessionId,
      threadId: created.mainThreadId,
      bodies: [{ type: 'workspace-prepared' }],
    })
    await archive({ service, sessionId: created.sessionId, archived: true })

    const { lease } = await plane.currentLease({ sessionId: created.sessionId })

    expect(await inboxKindsOf({ plane, sessionId: created.sessionId })).not.toContain(
      INBOX_KIND_STOP,
    )
    expect(lease.holderHostId).toBeNull()
    expect(dispatcher.dispatches).toEqual([
      {
        payload: { sessionId: created.sessionId, epoch: lease.epoch },
        idempotencyKey: `pod-sleep:${created.sessionId}:archived-${lease.epoch}`,
      },
    ])
  })

  it('takes a running turn off its holder instead of posting a stop', async () => {
    const { plane, service, dispatcher } = setup()
    const created = await service.create({ userId: 'user-a', projectId: 'proj-a' })
    await appendAsHolder({
      plane,
      sessionId: created.sessionId,
      threadId: created.mainThreadId,
      bodies: [{ type: 'turn-started', turnId: 'turn-1', cause: ETurnCause.Input }],
    })
    const held = await plane.currentLease({ sessionId: created.sessionId })

    const archived = await archive({ service, sessionId: created.sessionId, archived: true })

    expect(archived.archivedAt).toEqual(expect.any(String))
    expect(await inboxKindsOf({ plane, sessionId: created.sessionId })).not.toContain(
      INBOX_KIND_STOP,
    )
    const current = await plane.currentLease({ sessionId: created.sessionId })
    expect(current.lease.holderHostId).toBeNull()
    expect(current.lease.epoch).toBeGreaterThan(held.lease.epoch)
    expect(dispatcher.dispatches).toEqual([
      {
        payload: { sessionId: created.sessionId, epoch: current.lease.epoch },
        idempotencyKey: `pod-sleep:${created.sessionId}:archived-${current.lease.epoch}`,
      },
    ])
  })

  it('leaves the pod asleep on unarchive', async () => {
    const { plane, service, dispatcher } = setup()
    const created = await service.create({ userId: 'user-a', projectId: 'proj-a' })
    await archive({ service, sessionId: created.sessionId, archived: true })

    await archive({ service, sessionId: created.sessionId, archived: false })

    expect(dispatcher.dispatches).toHaveLength(1)
    const { lease } = await plane.currentLease({ sessionId: created.sessionId })
    expect(lease.wantsHolder).toBe(false)
  })

  it('keeps a pod that another session still runs on', async () => {
    const { store, service, dispatcher } = setup()
    const created = await service.create({ userId: 'user-a', projectId: 'proj-a' })
    await store.transact((tx) =>
      tx.createSession({
        sessionId: 'peer-1',
        userId: 'user-a',
        projectId: 'proj-a',
        mainThreadId: 'peer-thread-1',
        modelRef: 'anthropic/claude',
        modelEffort: 'medium',
        modelFast: false,
        sandboxProvider: 'agent37',
        credentialSource: 'platform',
        sandboxInstanceId: null,
        podSessionId: created.sessionId,
        at: NOW,
      }),
    )

    await archive({ service, sessionId: created.sessionId, archived: true })

    expect(dispatcher.dispatches).toHaveLength(0)
  })

  it('still archives when the sleep cannot be dispatched', async () => {
    const dispatcher = new FakePodResizeDispatcher()
    dispatcher.failure = new Error('trigger is down')
    const { service } = setup({ dispatcher })
    const created = await service.create({ userId: 'user-a', projectId: 'proj-a' })

    const archived = await archive({ service, sessionId: created.sessionId, archived: true })

    expect(archived.archivedAt).toEqual(expect.any(String))
    expect((await service.list({ userId: 'user-a' })).sessions[0]?.archivedAt).toBe(
      archived.archivedAt,
    )
  })
})
