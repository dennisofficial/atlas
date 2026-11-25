import { describe, expect, it, mock } from 'bun:test'
import { INBOX_KIND_RETRY } from '@dltech/atlas-core'
import { INBOX_KIND_MESSAGE, SESSION_ARCHIVED_MESSAGE } from '@dltech/atlas-protocol'

import type { PodOps } from '../../../agent'
import { SessionArchivedError } from './session-archived.error'
import { setupSessionsService as setup } from './sessions.service.fixture'

const archivedSessionOf = async () => {
  const hold = mock((_args: { sessionId: string }) => true)
  const context = setup({ ops: { hold } as unknown as PodOps })
  const created = await context.service.create({ userId: 'user-a', projectId: 'proj-a' })
  await context.service.archive({
    userId: 'user-a',
    sessionId: created.sessionId,
    archived: true,
  })
  const queued = (
    await context.plane.readInbox({
      sessionId: created.sessionId,
      afterId: 0,
      limit: 10,
    })
  ).length
  return { ...context, hold, queued, sessionId: created.sessionId }
}

const refusalOf = async (work: Promise<unknown>): Promise<SessionArchivedError> => {
  const failure = await work.then(
    () => undefined,
    (error: unknown) => error,
  )
  if (!(failure instanceof SessionArchivedError)) throw failure
  return failure
}

const archiveRefuses = async (work: Promise<unknown>): Promise<void> => {
  const failure = await refusalOf(work)
  expect(failure.code).toBe('PRECONDITION_FAILED')
  expect(failure.message).toBe(SESSION_ARCHIVED_MESSAGE)
}

const queuedKindsOf = async (args: {
  plane: ReturnType<typeof setup>['plane']
  sessionId: string
}): Promise<string[]> => {
  const entries = await args.plane.readInbox({ sessionId: args.sessionId, afterId: 0, limit: 10 })
  return entries.map((entry) => entry.kind)
}

describe('SessionsService on an archived session', () => {
  it('refuses a posted message and queues nothing', async () => {
    const { plane, service, queued, sessionId } = await archivedSessionOf()

    await archiveRefuses(service.post({ userId: 'user-a', sessionId, text: 'hello' }))

    expect(await queuedKindsOf({ plane, sessionId })).toHaveLength(queued)
  })

  it('refuses a retry', async () => {
    const { plane, service, queued, sessionId } = await archivedSessionOf()

    await archiveRefuses(service.retry({ userId: 'user-a', sessionId }))

    expect(await queuedKindsOf({ plane, sessionId })).toHaveLength(queued)
  })

  it('refuses a wake and leaves the claim loop alone', async () => {
    const { plane, service, sessionId } = await archivedSessionOf()

    await archiveRefuses(service.wake({ userId: 'user-a', sessionId }))

    const { lease } = await plane.currentLease({ sessionId })
    expect(lease.wantsHolder).toBe(false)
  })

  it('refuses a pod wake', async () => {
    const { service, sessionId } = await archivedSessionOf()

    await archiveRefuses(service.wakePod({ userId: 'user-a', sessionId }))
  })

  it('refuses a pod hold before it reaches the pod', async () => {
    const { hold, service, sessionId } = await archivedSessionOf()

    await archiveRefuses(service.holdPod({ userId: 'user-a', sessionId }))

    expect(hold).not.toHaveBeenCalled()
  })

  it('refuses a command that waits for a holder', async () => {
    const { plane, service, queued, sessionId } = await archivedSessionOf()

    await archiveRefuses(
      service.command({ userId: 'user-a', sessionId, name: 'test-rename', args: { title: 'x' } }),
    )

    expect(await queuedKindsOf({ plane, sessionId })).toHaveLength(queued)
  })

  it('refuses a model change', async () => {
    const { service, sessionId } = await archivedSessionOf()

    await archiveRefuses(
      service.command({
        userId: 'user-a',
        sessionId,
        name: 'model-set',
        args: { model: 'anthropic/claude-sonnet-4-5' },
      }),
    )

    expect((await service.events({ userId: 'user-a', sessionId })).events).toHaveLength(0)
  })

  it('refuses a resize and dispatches nothing', async () => {
    const { dispatcher, service, sessionId } = await archivedSessionOf()
    const dispatched = dispatcher.dispatches.length

    await archiveRefuses(
      service.command({
        userId: 'user-a',
        sessionId,
        name: 'resize',
        args: { vcpus: 4, memoryGb: 8 },
      }),
    )

    expect(dispatcher.dispatches).toHaveLength(dispatched)
  })

  it('renames an archived session and reads it back', async () => {
    const { plane, service, sessionId } = await archivedSessionOf()

    expect(
      await service.command({
        userId: 'user-a',
        sessionId,
        name: 'rename',
        args: { name: 'Kept' },
      }),
    ).toEqual({})
    expect((await plane.readSession({ sessionId }))?.title).toBe('Kept')
    expect((await service.events({ userId: 'user-a', sessionId })).events).toHaveLength(0)
  })

  it('takes input again once it is unarchived', async () => {
    const { hold, plane, service, sessionId } = await archivedSessionOf()
    await service.archive({ userId: 'user-a', sessionId, archived: false })

    await service.post({ userId: 'user-a', sessionId, text: 'hello' })
    await service.retry({ userId: 'user-a', sessionId })
    expect(await service.wake({ userId: 'user-a', sessionId })).toEqual({ state: 'waking' })
    expect(await service.holdPod({ userId: 'user-a', sessionId })).toEqual({ held: true })
    expect(hold).toHaveBeenCalledWith({ sessionId })
    expect(
      await service.command({
        userId: 'user-a',
        sessionId,
        name: 'test-rename',
        args: { title: 'x' },
      }),
    ).toEqual({ inboxId: expect.any(Number) })

    const kinds = await queuedKindsOf({ plane, sessionId })
    expect(kinds).toContain(INBOX_KIND_MESSAGE)
    expect(kinds).toContain(INBOX_KIND_RETRY)
  })
})
