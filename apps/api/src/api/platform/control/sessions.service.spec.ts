import { describe, expect, it } from 'bun:test'
import { BadRequestException, NotFoundException } from '@nestjs/common'
import { chainEvents, toRunId, toThreadId } from '@dltech/atlas-core'
import { ECredentialSource, ESandboxProvider, EWithdrawRefusal } from '@dltech/atlas-protocol'
import {
  appendBodies,
  logWithdrawn,
  NOW,
  postedBody,
  setupSessionsService as setup,
} from './sessions.service.fixture'

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
    expect(JSON.parse(inbox[0]?.payload ?? '')).toEqual({ text: 'hello', via: 'operator' })

    const events = await service.events({ userId: 'user-a', sessionId: created.sessionId })
    expect(events.events).toEqual([])
  })

  it('creates the session and its first message together, so the message exists when create returns', async () => {
    const { plane, service } = setup()

    const created = await service.create({
      userId: 'user-a',
      projectId: 'proj-a',
      firstMessage: { text: 'build me a thing' },
    })

    const inbox = await plane.readInbox({ sessionId: created.sessionId, afterId: 0, limit: 10 })
    expect(inbox).toHaveLength(1)
    expect(inbox[0]?.kind).toBe('message')
    expect(JSON.parse(inbox[0]?.payload ?? '')).toEqual({
      text: 'build me a thing',
      via: 'operator',
    })
  })

  it('creates the session on the model the caller names', async () => {
    const { plane, service } = setup()
    const created = await service.create({
      userId: 'user-a',
      projectId: 'proj-a',
      model: 'anthropic/claude-opus-5-5',
      effort: 'low',
      fast: true,
    })
    const row = await plane.readSession({ sessionId: created.sessionId })
    expect(row?.modelRef).toBe('anthropic/claude-opus-5-5')
    expect(row?.modelEffort).toBe('low')
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

  it('hides a soft-deleted session and answers NOT_FOUND for every interaction with it', async () => {
    const { service, store } = setup()
    const created = await service.create({ userId: 'user-a', projectId: 'proj-a', title: 'gone' })
    store.softDeleteSession(created.sessionId)

    expect((await service.list({ userId: 'user-a' })).sessions).toEqual([])
    await expect(
      service.post({ userId: 'user-a', sessionId: created.sessionId, text: 'hi' }),
    ).rejects.toBeInstanceOf(NotFoundException)
    await expect(
      service.archive({ userId: 'user-a', sessionId: created.sessionId, archived: false }),
    ).rejects.toBeInstanceOf(NotFoundException)
    await expect(
      service.view({ userId: 'user-a', sessionId: created.sessionId }),
    ).rejects.toBeInstanceOf(NotFoundException)
  })

  it('withdraws a pending message for the owner and drops it from the log queue', async () => {
    const { plane, service } = setup()
    const created = await service.create({ userId: 'user-a', projectId: 'proj-a' })
    const lease = await plane.grant({ sessionId: created.sessionId, hostId: 9001 })
    const { inboxId } = await service.post({
      userId: 'user-a',
      sessionId: created.sessionId,
      text: 'hi',
    })
    await appendBodies({
      plane,
      threadId: created.mainThreadId,
      epoch: lease.epoch,
      bodies: [postedBody({ inboxId, text: 'hi' })],
    })
    const before = await service.status({ userId: 'user-a', sessionId: created.sessionId })
    expect(before.queued?.map((entry) => entry.text)).toEqual(['hi'])

    expect(
      await service.withdraw({ userId: 'user-a', sessionId: created.sessionId, inboxId }),
    ).toEqual({ ok: true })
    const staged = await service.status({ userId: 'user-a', sessionId: created.sessionId })
    expect(staged.queued?.map((entry) => entry.text)).toEqual(['hi'])

    await logWithdrawn({
      plane,
      sessionId: created.sessionId,
      threadId: created.mainThreadId,
      epoch: lease.epoch,
      inboxId,
      text: 'hi',
    })
    const after = await service.status({ userId: 'user-a', sessionId: created.sessionId })
    expect(after.queued).toBeUndefined()
  })

  it('stages a withdraw for a consumed entry and leaves the refusal to the holder', async () => {
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
    ).toEqual({ ok: true })
    const staged = await plane.readInbox({
      sessionId: created.sessionId,
      afterId: 0,
      limit: 10,
    })
    expect(staged.map((entry) => entry.kind)).toEqual(['withdraw'])
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

  it('creates a session with no project and lists it as projectless', async () => {
    const { plane, service } = setup()

    const created = await service.create({ userId: 'user-a' })

    expect(created.sessionId).toBeDefined()
    expect(created.mainThreadId).toBeDefined()
    expect((await plane.readSession({ sessionId: created.sessionId }))?.projectId).toBeNull()
    const listed = await service.list({ userId: 'user-a' })
    expect(listed.sessions).toHaveLength(1)
    expect(listed.sessions[0]?.sessionId).toBe(created.sessionId)
    expect(listed.sessions[0]?.projectId).toBeNull()
  })

  it('keeps a projectless session owned by its user alone', async () => {
    const { service, projects } = setup()

    const created = await service.create({ userId: 'user-a' })
    const explicit = await service.create({ userId: 'user-a', projectId: null })

    expect(projects.ownerLookups).toEqual([])
    for (const sessionId of [created.sessionId, explicit.sessionId]) {
      await expect(
        service.post({ userId: 'user-b', sessionId, text: 'hi' }),
      ).rejects.toBeInstanceOf(NotFoundException)
    }
  })
})

describe('SessionsService model choice', () => {
  it('pins a complete model when the caller names none', async () => {
    const { plane, service } = setup()

    const created = await service.create({ userId: 'user-a', projectId: 'proj-a' })

    const row = await plane.readSession({ sessionId: created.sessionId })
    expect(row?.modelRef).toBe('anthropic/claude-haiku-4-5')
    expect(row?.modelEffort).toBe('medium')
    expect(row?.modelFast).toBe(false)
  })

  it('fills the effort and fast of a named model from the default', async () => {
    const { plane, service } = setup()

    const created = await service.create({
      userId: 'user-a',
      projectId: 'proj-a',
      model: 'anthropic/claude-opus-5-5',
    })

    const row = await plane.readSession({ sessionId: created.sessionId })
    expect(row?.modelRef).toBe('anthropic/claude-opus-5-5')
    expect(row?.modelEffort).toBe('medium')
    expect(row?.modelFast).toBe(false)
  })

  it('model-set writes ref, effort and fast and appends no inbox entry', async () => {
    const { plane, service } = setup()
    const created = await service.create({ userId: 'user-a', projectId: 'proj-a' })

    const posted = await service.command({
      userId: 'user-a',
      sessionId: created.sessionId,
      name: 'model-set',
      args: { model: 'anthropic/claude-opus-5-5', effort: 'low', fast: true },
    })

    expect(posted).toEqual({})
    const row = await plane.readSession({ sessionId: created.sessionId })
    expect(row?.modelRef).toBe('anthropic/claude-opus-5-5')
    expect(row?.modelEffort).toBe('low')
    expect(row?.modelFast).toBe(true)
    const inbox = await plane.readInbox({ sessionId: created.sessionId, afterId: 0, limit: 10 })
    expect(inbox).toEqual([])
  })

  it('refuses model-set arguments that name an account and leaves the row alone', async () => {
    const { plane, service } = setup()
    const created = await service.create({ userId: 'user-a', projectId: 'proj-a' })

    await expect(
      service.command({
        userId: 'user-a',
        sessionId: created.sessionId,
        name: 'model-set',
        args: { model: 'anthropic/claude-opus-5-5', accountId: 'acct-b' },
      }),
    ).rejects.toBeInstanceOf(BadRequestException)
    const row = await plane.readSession({ sessionId: created.sessionId })
    expect(row?.modelRef).toBe('anthropic/claude-haiku-4-5')
    expect(await plane.readInbox({ sessionId: created.sessionId, afterId: 0, limit: 10 })).toEqual(
      [],
    )
  })
})

describe('SessionsService sandbox provider', () => {
  it('pins vercel and platform credentials when the caller names no provider', async () => {
    const { plane, service } = setup()

    const created = await service.create({ userId: 'user-a', projectId: 'proj-a' })

    const row = await plane.readSession({ sessionId: created.sessionId })
    expect(row?.sandboxProvider).toBe(ESandboxProvider.Vercel)
    expect(row?.credentialSource).toBe(ECredentialSource.Platform)
    expect(row?.sandboxInstanceId).toBeNull()
  })

  it('takes the default provider from the environment', async () => {
    const { plane, service } = setup({ env: { SANDBOX_PROVIDER_DEFAULT: 'agent37' } })

    const created = await service.create({ userId: 'user-a', projectId: 'proj-a' })

    expect((await plane.readSession({ sessionId: created.sessionId }))?.sandboxProvider).toBe(
      ESandboxProvider.Agent37,
    )
  })

  it('pins the provider the caller names', async () => {
    const { plane, service } = setup()

    const created = await service.create({
      userId: 'user-a',
      projectId: 'proj-a',
      provider: 'agent37',
    })

    expect((await plane.readSession({ sessionId: created.sessionId }))?.sandboxProvider).toBe(
      ESandboxProvider.Agent37,
    )
  })

  it('refuses an unknown provider', async () => {
    const { service } = setup()

    await expect(
      service.create({ userId: 'user-a', projectId: 'proj-a', provider: 'docker' }),
    ).rejects.toBeInstanceOf(BadRequestException)
  })
})
