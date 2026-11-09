import { describe, expect, it } from 'bun:test'
import { NotFoundException } from '@nestjs/common'
import { chainEvents, toRunId, toThreadId } from '@dltech/atlas-core'
import { EWithdrawRefusal } from '@dltech/atlas-protocol'
import { NOW, setupSessionsService as setup } from './sessions.service.fixture'

describe('SessionsService', () => {
  it('creates, lists, posts and reads events for the owner', async () => {
    const { plane, service } = setup()

    const created = await service.create({ userId: 'user-a', projectId: 'proj-a', title: 't' })
    expect(created.sessionId).toBeDefined()
    expect(created.mainThreadId).toBeDefined()

    const listed = await service.list({ userId: 'user-a' })
    expect(listed.sessions).toHaveLength(1)
    expect(listed.sessions[0]?.sessionId).toBe(created.sessionId)
    expect(listed.sessions[0]?.title).toBe('t')

    const posted = await service.post({
      userId: 'user-a',
      sessionId: created.sessionId,
      text: 'hello',
    })
    expect(posted.inboxId).toBe(1)

    const inbox = await plane.readInbox({ sessionId: created.sessionId, afterId: 0, limit: 10 })
    expect(inbox).toHaveLength(1)
    expect(inbox[0]?.kind).toBe('message')
    expect(JSON.parse(inbox[0]?.payload ?? '')).toEqual({ text: 'hello' })

    const events = await service.events({ userId: 'user-a', sessionId: created.sessionId })
    expect(events.events).toEqual([])
  })

  it('creates the session on the model the caller names', async () => {
    const { plane, service } = setup()
    const created = await service.create({
      userId: 'user-a',
      projectId: 'proj-a',
      model: 'openai/gpt-5',
      effort: 'high',
      fast: true,
    })
    const row = await plane.readSession({ sessionId: created.sessionId })
    expect(row?.modelRef).toBe('openai/gpt-5')
    expect(row?.modelEffort).toBe('high')
    expect(row?.modelFast).toBe(true)
  })

  it('reports the last event time of a session', async () => {
    const { plane, service } = setup()
    const created = await service.create({ userId: 'user-a', projectId: 'proj-a', title: 'Kept' })
    expect((await service.list({ userId: 'user-a' })).sessions[0]?.updatedAt).toBe(NOW)

    const lease = await plane.grant({ sessionId: created.sessionId, hostId: 9001 })
    await plane.append({
      threadId: created.mainThreadId,
      epoch: lease.epoch,
      events: chainEvents({
        threadId: toThreadId(created.mainThreadId),
        runId: toRunId('run-1'),
        epoch: lease.epoch,
        at: '2026-11-03T13:00:00.000Z',
        bodies: [{ type: 'workspace-prepared' }],
      }),
    })
    const after = await service.list({ userId: 'user-a' })
    expect(after.sessions[0]?.updatedAt).toBe('2026-11-03T13:00:00.000Z')
  })

  it('refuses a non-owned or unknown session with NOT_FOUND', async () => {
    const { service } = setup()
    const created = await service.create({ userId: 'user-a', projectId: 'proj-a' })

    await expect(
      service.post({ userId: 'user-b', sessionId: created.sessionId, text: 'hi' }),
    ).rejects.toBeInstanceOf(NotFoundException)
    await expect(
      service.post({ userId: 'user-a', sessionId: 'missing', text: 'hi' }),
    ).rejects.toBeInstanceOf(NotFoundException)
    await expect(
      service.events({ userId: 'user-b', sessionId: created.sessionId }),
    ).rejects.toBeInstanceOf(NotFoundException)
    await expect(
      service.status({ userId: 'user-b', sessionId: created.sessionId }),
    ).rejects.toBeInstanceOf(NotFoundException)
  })

  it('withdraws a pending message for the owner and removes it from status', async () => {
    const { service } = setup()
    const created = await service.create({ userId: 'user-a', projectId: 'proj-a' })
    const { inboxId } = await service.post({
      userId: 'user-a',
      sessionId: created.sessionId,
      text: 'hi',
    })
    const before = await service.status({ userId: 'user-a', sessionId: created.sessionId })
    expect(before.queued?.map((entry) => entry.text)).toEqual(['hi'])

    expect(
      await service.withdraw({ userId: 'user-a', sessionId: created.sessionId, inboxId }),
    ).toEqual({ ok: true })
    const after = await service.status({ userId: 'user-a', sessionId: created.sessionId })
    expect(after.queued).toBeUndefined()
  })

  it('refuses to withdraw a consumed entry', async () => {
    const { plane, service } = setup()
    const created = await service.create({ userId: 'user-a', projectId: 'proj-a' })
    const { inboxId } = await service.post({
      userId: 'user-a',
      sessionId: created.sessionId,
      text: 'hi',
    })
    const lease = await plane.grant({ sessionId: created.sessionId, hostId: 9001 })
    const consumed = await plane.append({
      threadId: created.mainThreadId,
      epoch: lease.epoch,
      events: chainEvents({
        threadId: toThreadId(created.mainThreadId),
        runId: toRunId('run-1'),
        epoch: lease.epoch,
        at: NOW,
        bodies: [{ type: 'input-consumed', inboxId }],
      }),
    })
    expect(consumed.ok).toBe(true)

    expect(
      await service.withdraw({ userId: 'user-a', sessionId: created.sessionId, inboxId }),
    ).toEqual({ ok: false, reason: EWithdrawRefusal.AlreadyConsumed })
  })

  it('answers unknown for a missing entry and refuses non-owners', async () => {
    const { service } = setup()
    const created = await service.create({ userId: 'user-a', projectId: 'proj-a' })
    expect(
      await service.withdraw({ userId: 'user-a', sessionId: created.sessionId, inboxId: 99 }),
    ).toEqual({ ok: false, reason: EWithdrawRefusal.Unknown })
    await expect(
      service.withdraw({ userId: 'user-b', sessionId: created.sessionId, inboxId: 1 }),
    ).rejects.toBeInstanceOf(NotFoundException)
  })

  it('archives and unarchives a session for its owner and reports it in the list', async () => {
    const { service } = setup()
    const created = await service.create({ userId: 'user-a', projectId: 'proj-a' })
    const archived = await service.archive({
      userId: 'user-a',
      sessionId: created.sessionId,
      archived: true,
    })
    expect(archived.archivedAt).toEqual(expect.any(String))
    const listed = await service.list({ userId: 'user-a' })
    expect(listed.sessions[0]?.archivedAt).toBe(archived.archivedAt)
    expect(
      await service.archive({ userId: 'user-a', sessionId: created.sessionId, archived: false }),
    ).toEqual({ archivedAt: null })
    expect((await service.list({ userId: 'user-a' })).sessions[0]?.archivedAt).toBeNull()
  })

  it('refuses to archive a session the user does not own or that does not exist', async () => {
    const { service } = setup()
    const created = await service.create({ userId: 'user-a', projectId: 'proj-a' })
    await expect(
      service.archive({ userId: 'user-b', sessionId: created.sessionId, archived: true }),
    ).rejects.toBeInstanceOf(NotFoundException)
    await expect(
      service.archive({ userId: 'user-a', sessionId: 'missing', archived: true }),
    ).rejects.toBeInstanceOf(NotFoundException)
    expect((await service.list({ userId: 'user-a' })).sessions[0]?.archivedAt).toBeNull()
  })

  it('refuses a project the user does not own', async () => {
    const { service } = setup()
    await expect(service.create({ userId: 'user-b', projectId: 'proj-a' })).rejects.toBeInstanceOf(
      NotFoundException,
    )
  })
})
