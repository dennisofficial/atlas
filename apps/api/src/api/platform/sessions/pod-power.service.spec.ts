import { describe, expect, it } from 'bun:test'
import {
  chainEvents,
  ETurnCause,
  INBOX_KIND_STOP,
  toRunId,
  toThreadId,
  type RecordEventBody,
} from '@dltech/atlas-core'

import { POD_TURN_RUNNING } from './pod-power.error'
import { NOW, setupSessionsService as setup } from './sessions.service.fixture'

const startTurn = async (args: {
  plane: ReturnType<typeof setup>['plane']
  sessionId: string
  threadId: string
}): Promise<void> => {
  const granted = await args.plane.grant({ sessionId: args.sessionId, hostId: 9000 })
  const bodies: RecordEventBody[] = [
    { type: 'turn-started', turnId: 'turn-1', cause: ETurnCause.Input },
  ]
  const appended = await args.plane.append({
    threadId: args.threadId,
    epoch: granted.epoch,
    events: chainEvents({
      threadId: toThreadId(args.threadId),
      runId: toRunId('run-1'),
      epoch: granted.epoch,
      at: NOW,
      bodies,
    }),
  })
  if (!appended.ok) throw new Error('the turn never started')
}

const prepare = async (args: {
  plane: ReturnType<typeof setup>['plane']
  sessionId: string
  threadId: string
}): Promise<void> => {
  const granted = await args.plane.grant({ sessionId: args.sessionId, hostId: 9000 })
  const appended = await args.plane.append({
    threadId: args.threadId,
    epoch: granted.epoch,
    events: chainEvents({
      threadId: toThreadId(args.threadId),
      runId: toRunId('run-0'),
      epoch: granted.epoch,
      at: NOW,
      bodies: [{ type: 'workspace-prepared' }],
    }),
  })
  if (!appended.ok) throw new Error('the workspace never prepared')
  await args.plane.revoke({ sessionId: args.sessionId, wantsHolder: false })
}

const codeOf = async (work: Promise<unknown>): Promise<string | undefined> => {
  const failure = (await work.catch((error: unknown) => error)) as {
    getResponse?: () => unknown
  }
  const response = failure.getResponse?.()
  if (typeof response !== 'object' || response === null) return undefined
  const code = (response as { code?: unknown }).code
  return typeof code === 'string' ? code : undefined
}

describe('SessionsService.sleepPod', () => {
  it('refuses a pod mid-turn without force, and asks for confirmation', async () => {
    const { plane, service, dispatcher } = setup()
    const created = await service.create({ userId: 'user-a', projectId: 'proj-a' })
    await startTurn({ plane, sessionId: created.sessionId, threadId: created.mainThreadId })

    const refused = service.sleepPod({ userId: 'user-a', sessionId: created.sessionId })

    expect(await codeOf(refused)).toBe(POD_TURN_RUNNING)
    expect(dispatcher.dispatches).toHaveLength(0)
  })

  it('stops the turn through the inbox and dispatches the sleep with force', async () => {
    const { plane, service, dispatcher } = setup()
    const created = await service.create({ userId: 'user-a', projectId: 'proj-a' })
    await startTurn({ plane, sessionId: created.sessionId, threadId: created.mainThreadId })
    const { lease } = await plane.currentLease({ sessionId: created.sessionId })

    expect(
      await service.sleepPod({ userId: 'user-a', sessionId: created.sessionId, force: true }),
    ).toEqual({ state: 'sleeping' })

    const inbox = await plane.readInbox({ sessionId: created.sessionId, afterId: 0, limit: 20 })
    expect(inbox.map((entry) => entry.kind)).toContain(INBOX_KIND_STOP)
    expect(dispatcher.dispatches).toEqual([
      {
        payload: { sessionId: created.sessionId, epoch: lease.epoch },
        idempotencyKey: `pod-sleep:${created.sessionId}:${lease.epoch}`,
      },
    ])
  })

  it('leaves the stopped session with its holder, so no other host claims the pod it will sleep', async () => {
    const { plane, service, store } = setup()
    store.markHostPresent(9000)
    const created = await service.create({ userId: 'user-a', projectId: 'proj-a' })
    await startTurn({ plane, sessionId: created.sessionId, threadId: created.mainThreadId })

    await service.sleepPod({ userId: 'user-a', sessionId: created.sessionId, force: true })

    const held = await plane.currentLease({ sessionId: created.sessionId })
    expect(held.lease.holderHostId).toBe(9000)
    expect(held.lease.wantsHolder).toBe(false)
    const claimed = await plane.claimNext({ hostId: 9001, limit: 10 })
    expect(claimed.leases.map((lease) => lease.sessionId)).not.toContain(created.sessionId)
  })

  it('sleeps an idle pod without posting a stop', async () => {
    const { plane, service, dispatcher } = setup()
    const created = await service.create({ userId: 'user-a', projectId: 'proj-a' })
    await prepare({ plane, sessionId: created.sessionId, threadId: created.mainThreadId })

    expect(await service.sleepPod({ userId: 'user-a', sessionId: created.sessionId })).toEqual({
      state: 'sleeping',
    })

    const inbox = await plane.readInbox({ sessionId: created.sessionId, afterId: 0, limit: 20 })
    expect(inbox.map((entry) => entry.kind)).not.toContain(INBOX_KIND_STOP)
    expect(dispatcher.dispatches).toHaveLength(1)
  })

  it('refuses another user', async () => {
    const { service } = setup()
    const created = await service.create({ userId: 'user-a', projectId: 'proj-a' })

    await expect(
      service.sleepPod({ userId: 'user-b', sessionId: created.sessionId }),
    ).rejects.toThrow('session not found')
  })
})

describe('SessionsService.sleepPod idempotency', () => {
  it('keys one sleep once, so a repeated request does not sleep twice', async () => {
    const { plane, service, dispatcher } = setup()
    const created = await service.create({ userId: 'user-a', projectId: 'proj-a' })
    await prepare({ plane, sessionId: created.sessionId, threadId: created.mainThreadId })

    await service.sleepPod({ userId: 'user-a', sessionId: created.sessionId })
    await service.sleepPod({ userId: 'user-a', sessionId: created.sessionId })

    const keys = dispatcher.dispatches.map((dispatch) => dispatch.idempotencyKey)
    expect(keys).toHaveLength(2)
    expect(keys[0]).toBe(keys[1])
    expect(keys[0]).toStartWith(`pod-sleep:${created.sessionId}:`)
  })

  it('keys the next sleep separately once the pod was woken again', async () => {
    const { plane, service, dispatcher } = setup()
    const created = await service.create({ userId: 'user-a', projectId: 'proj-a' })
    await prepare({ plane, sessionId: created.sessionId, threadId: created.mainThreadId })

    await service.sleepPod({ userId: 'user-a', sessionId: created.sessionId })
    await service.wakePod({ userId: 'user-a', sessionId: created.sessionId })
    await service.sleepPod({ userId: 'user-a', sessionId: created.sessionId })

    const keys = dispatcher.dispatches.map((dispatch) => dispatch.idempotencyKey)
    expect(keys).toHaveLength(2)
    expect(keys[0]).not.toBe(keys[1])
  })
})

describe('SessionsService.wakePod', () => {
  it('asks the claim loop for a holder, the same as a wake', async () => {
    const { plane, service } = setup()
    const created = await service.create({ userId: 'user-a', projectId: 'proj-a' })

    expect(await service.wakePod({ userId: 'user-a', sessionId: created.sessionId })).toEqual({
      state: 'waking',
    })
    expect((await plane.currentLease({ sessionId: created.sessionId })).lease.wantsHolder).toBe(
      true,
    )
  })
})
