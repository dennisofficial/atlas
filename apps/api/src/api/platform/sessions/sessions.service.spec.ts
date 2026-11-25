import { describe, expect, it } from 'bun:test'
import { BadRequestException, NotFoundException } from '@nestjs/common'
import {
  chainEvents,
  ESubscriptionActor,
  ETurnCause,
  ETurnEndedBy,
  ETurnOutcome,
  toRunId,
  toThreadId,
} from '@dltech/atlas-core'
import { ECredentialSource, ESandboxProvider, EWithdrawRefusal } from '@dltech/atlas-protocol'
import {
  appendBodies,
  logWithdrawn,
  NOW,
  postedBody,
  RecordingPreviewTeardown,
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

  it('ends the subscriptions of an archived session', async () => {
    const { plane, service } = setup()
    const created = await service.create({ userId: 'user-a', projectId: 'proj-a' })
    await plane.subscribe({
      sessionId: created.sessionId,
      threadId: created.mainThreadId,
      provider: 'github.pull-request',
      target: { repo: 'github.com/compai/app', number: 7 },
      label: 'compai/app#7',
      events: [],
      lease: { repo: 'compai/app', subject: { kind: 'pull-request', number: 7 } },
      by: ESubscriptionActor.Agent,
    })

    await service.archive({ userId: 'user-a', sessionId: created.sessionId, archived: true })

    expect(await plane.listSubscriptions({ sessionId: created.sessionId })).toEqual([])
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

  it('refuses create with a bare model id', async () => {
    const { service } = setup()

    await expect(
      service.create({ userId: 'user-a', projectId: 'proj-a', model: 'claude-opus-5-5' }),
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  it('refuses model-set with a bare model id and leaves the row alone', async () => {
    const { plane, service } = setup()
    const created = await service.create({ userId: 'user-a', projectId: 'proj-a' })

    await expect(
      service.command({
        userId: 'user-a',
        sessionId: created.sessionId,
        name: 'model-set',
        args: { model: 'claude-opus-5-5' },
      }),
    ).rejects.toBeInstanceOf(BadRequestException)

    const row = await plane.readSession({ sessionId: created.sessionId })
    expect(row?.modelRef).toBe('anthropic/claude-haiku-4-5')
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
  it('pins agent37 and platform credentials when the caller names no provider', async () => {
    const { plane, service } = setup()

    const created = await service.create({ userId: 'user-a', projectId: 'proj-a' })

    const row = await plane.readSession({ sessionId: created.sessionId })
    expect(row?.sandboxProvider).toBe(ESandboxProvider.Agent37)
    expect(row?.credentialSource).toBe(ECredentialSource.Platform)
    expect(row?.sandboxInstanceId).toBeNull()
  })

  it('pins the provider the caller names', async () => {
    const { plane, service } = setup()

    const created = await service.create({
      userId: 'user-a',
      projectId: 'proj-a',
      provider: 'vercel',
    })

    expect((await plane.readSession({ sessionId: created.sessionId }))?.sandboxProvider).toBe(
      ESandboxProvider.Vercel,
    )
  })

  it('refuses an unknown provider', async () => {
    const { service } = setup()

    await expect(
      service.create({ userId: 'user-a', projectId: 'proj-a', provider: 'docker' }),
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  it('reads the events of a child thread the caller names', async () => {
    const { plane, service } = setup()
    const created = await service.create({ userId: 'user-a', projectId: 'proj-a' })
    const child = 'child-thread'
    await plane.createThread({ threadId: child, sessionId: created.sessionId })
    const lease = await plane.grant({ sessionId: created.sessionId, hostId: 9001 })
    await appendBodies({
      plane,
      threadId: child,
      epoch: lease.epoch,
      bodies: [{ type: 'user-said', text: 'child work' }],
    })

    const events = await service.events({
      userId: 'user-a',
      sessionId: created.sessionId,
      threadId: child,
    })
    expect(events.events).toHaveLength(1)
  })

  it('refuses the events of a thread outside the session', async () => {
    const { plane, service } = setup()
    const created = await service.create({ userId: 'user-a', projectId: 'proj-a' })
    const other = await service.create({ userId: 'user-a', projectId: 'proj-a' })

    await expect(
      service.events({
        userId: 'user-a',
        sessionId: created.sessionId,
        threadId: other.mainThreadId,
      }),
    ).rejects.toBeInstanceOf(NotFoundException)
    expect(await plane.readThread({ threadId: other.mainThreadId })).toBeDefined()
  })
})

describe('SessionsService markRead', () => {
  const endedTurn = async () => {
    const fixture = setup()
    const created = await fixture.service.create({ userId: 'user-a', projectId: 'proj-a' })
    const granted = await fixture.plane.grant({ sessionId: created.sessionId, hostId: 9001 })
    await appendBodies({
      plane: fixture.plane,
      threadId: created.mainThreadId,
      epoch: granted.epoch,
      bodies: [
        { type: 'turn-started', turnId: 'turn-1', cause: ETurnCause.Input },
        {
          type: 'turn-ended',
          turnId: 'turn-1',
          outcome: ETurnOutcome.Completed,
          by: ETurnEndedBy.Agent,
        },
      ],
    })
    return { ...fixture, created, epoch: granted.epoch }
  }

  it('dispatches one clear when the read advance passes a turn end', async () => {
    const { service, dispatcher, created } = await endedTurn()

    const { readSeq } = await service.markRead({
      userId: 'user-a',
      sessionId: created.sessionId,
      seq: 2,
    })

    expect(readSeq).toBe(2)
    expect(dispatcher.dispatches).toHaveLength(1)
    expect(dispatcher.dispatches[0]?.payload).toEqual({
      userId: 'user-a',
      sessionId: created.sessionId,
    })
    expect(dispatcher.dispatches[0]?.idempotencyKey).toBe(`notify-clear:${created.sessionId}:2`)
  })

  it('dispatches nothing when the advance stops short of the moment', async () => {
    const { service, dispatcher, created } = await endedTurn()

    await service.markRead({ userId: 'user-a', sessionId: created.sessionId, seq: 1 })

    expect(dispatcher.dispatches).toEqual([])
  })

  it('dispatches nothing when the moment is already read', async () => {
    const { service, dispatcher, created, plane, epoch } = await endedTurn()
    await service.markRead({ userId: 'user-a', sessionId: created.sessionId, seq: 2 })
    await appendBodies({
      plane,
      threadId: created.mainThreadId,
      epoch,
      bodies: [{ type: 'turn-started', turnId: 'turn-2', cause: ETurnCause.Input }],
    })

    await service.markRead({ userId: 'user-a', sessionId: created.sessionId, seq: 3 })

    expect(dispatcher.dispatches).toHaveLength(1)
  })

  it('keeps markRead green when the clear dispatch fails', async () => {
    const { service, dispatcher, created } = await endedTurn()
    dispatcher.failure = new Error('trigger is down')

    await expect(
      service.markRead({ userId: 'user-a', sessionId: created.sessionId, seq: 2 }),
    ).resolves.toEqual({ readSeq: 2 })
  })
})

describe('SessionsService archive marks the pod preview tunnel', () => {
  it('marks the pod deleting on archive and clears the mark on unarchive', async () => {
    const previews = new RecordingPreviewTeardown()
    const { service } = setup({ previews })
    const created = await service.create({ userId: 'user-a', projectId: 'proj-a' })

    await service.archive({ userId: 'user-a', sessionId: created.sessionId, archived: true })

    expect(previews.marked).toEqual([{ podSessionId: created.sessionId }])
    expect(previews.cleared).toEqual([])

    await service.archive({ userId: 'user-a', sessionId: created.sessionId, archived: false })

    expect(previews.cleared).toEqual([{ podSessionId: created.sessionId }])
    expect(previews.marked).toHaveLength(1)
  })

  it('marks the pod id a teammate shares with its lead exactly once', async () => {
    const previews = new RecordingPreviewTeardown()
    const { store, service } = setup({ previews })
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

    await service.archive({ userId: 'user-a', sessionId: 'peer-1', archived: true })

    expect(previews.marked).toEqual([{ podSessionId: created.sessionId }])
  })
})
