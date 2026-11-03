import { describe, expect, it } from 'bun:test'
import { NotFoundException } from '@nestjs/common'
import { ControlPlane } from '@dltech/atlas-control'
import { InMemoryControlStore } from '@dltech/atlas-control/testing'
import {
  chainEvents,
  ERunFailureKind,
  ESessionStatus,
  toRunId,
  toThreadId,
  type V2Body,
} from '@dltech/atlas-core'
import { inboxMessageSchema } from '@dltech/atlas-protocol'
import { SessionsService } from './sessions.service'
import { ProjectAccess } from './project-access'
import { WakePublisher } from './wake.publisher'

const NOW = '2026-11-03T12:00:00.000Z'

class FakeProjectAccess extends ProjectAccess {
  async ownerOf(args: { projectId: string }): Promise<string | undefined> {
    return args.projectId === 'proj-a' ? 'user-a' : undefined
  }
}

class RecordingWakePublisher extends WakePublisher {
  readonly published: string[] = []

  async publish(args: { sessionId: string }): Promise<void> {
    this.published.push(args.sessionId)
  }
}

class FailingWakePublisher extends WakePublisher {
  async publish(): Promise<void> {
    throw new Error('redis down')
  }
}

describe('SessionsService', () => {
  const setup = (args: { publisher?: WakePublisher } = {}) => {
    const plane = new ControlPlane({
      store: new InMemoryControlStore({ clock: () => NOW }),
    })
    const publisher = args.publisher ?? new RecordingWakePublisher()
    const service = new SessionsService(plane, publisher, new FakeProjectAccess())
    const published = publisher instanceof RecordingWakePublisher ? publisher.published : []
    return { plane, published, service }
  }

  it('creates, lists, posts and reads events for the owner', async () => {
    const { plane, published, service } = setup()

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
    expect(published).toEqual([created.sessionId])

    const inbox = await plane.readInbox({ sessionId: created.sessionId, afterId: 0, limit: 10 })
    expect(inbox).toHaveLength(1)
    expect(inbox[0]?.kind).toBe('message')
    expect(JSON.parse(inbox[0]?.payload ?? '')).toEqual({ text: 'hello' })

    const events = await service.events({ userId: 'user-a', sessionId: created.sessionId })
    expect(events.events).toEqual([])
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

  it('refuses a project the user does not own', async () => {
    const { service } = setup()
    await expect(service.create({ userId: 'user-b', projectId: 'proj-a' })).rejects.toBeInstanceOf(
      NotFoundException,
    )
  })

  it('swallows a failed wake publish', async () => {
    const { service } = setup({ publisher: new FailingWakePublisher() })
    const created = await service.create({ userId: 'user-a', projectId: 'proj-a' })
    const posted = await service.post({
      userId: 'user-a',
      sessionId: created.sessionId,
      text: 'hello',
    })
    expect(posted.inboxId).toBe(1)
  })

  it('maps an unconsumed post to sent and a consumed one past it', async () => {
    const { plane, service } = setup()
    const created = await service.create({ userId: 'user-a', projectId: 'proj-a' })
    await service.post({ userId: 'user-a', sessionId: created.sessionId, text: 'hi' })

    const sent = await service.status({ userId: 'user-a', sessionId: created.sessionId })
    expect(sent.state).toBe(ESessionStatus.Sent)
    expect(sent.lease.live).toBe(false)

    const granted = await plane.grant({
      sessionId: created.sessionId,
      holderId: 'host-1',
      ttlMs: 30_000,
    })
    const bodies: V2Body[] = [
      { type: 'input-consumed', inboxId: 1 },
      { type: 'user-said', text: 'hi', requestId: 'inbox:1' },
    ]
    const appended = await plane.append({
      threadId: created.mainThreadId,
      epoch: granted.epoch,
      events: chainEvents({
        threadId: toThreadId(created.mainThreadId),
        runId: toRunId('run-1'),
        epoch: granted.epoch,
        at: NOW,
        bodies,
      }),
    })
    expect(appended.ok).toBe(true)

    const thinking = await service.status({ userId: 'user-a', sessionId: created.sessionId })
    expect(thinking.state).toBe(ESessionStatus.Thinking)
    expect(thinking.lease).toEqual({ epoch: granted.epoch, holderId: 'host-1', live: true })

    const events = await service.events({ userId: 'user-a', sessionId: created.sessionId })
    expect(events.events).toHaveLength(2)
    expect(events.events[1]).toMatchObject({ type: 'user-said', text: 'hi' })
  })

  it('derives status from the tail of a log longer than one page', async () => {
    const { plane, service } = setup()
    const created = await service.create({ userId: 'user-a', projectId: 'proj-a' })
    const granted = await plane.grant({
      sessionId: created.sessionId,
      holderId: 'host-1',
      ttlMs: 30_000,
    })
    const bodies: V2Body[] = [
      ...Array.from({ length: 1000 }, (): V2Body => ({ type: 'user-said', text: 'filler' })),
      { type: 'run-failed', failure: { kind: ERunFailureKind.Network, message: 'latest failure' } },
    ]
    const appended = await plane.append({
      threadId: created.mainThreadId,
      epoch: granted.epoch,
      events: chainEvents({
        threadId: toThreadId(created.mainThreadId),
        runId: toRunId('run-1'),
        epoch: granted.epoch,
        at: NOW,
        bodies,
      }),
    })
    expect(appended.ok).toBe(true)
    const status = await service.status({ userId: 'user-a', sessionId: created.sessionId })
    expect(status.state).toBe(ESessionStatus.Failed)
  })

  it('stamps inbox messages with the same schema the host parses', async () => {
    const { plane, service } = setup()
    const created = await service.create({ userId: 'user-a', projectId: 'proj-a' })
    await service.post({ userId: 'user-a', sessionId: created.sessionId, text: 'run the tests' })
    const inbox = await plane.readInbox({ sessionId: created.sessionId, afterId: 0, limit: 10 })
    expect(inboxMessageSchema.parse(JSON.parse(inbox[0]?.payload ?? ''))).toEqual({
      text: 'run the tests',
    })
  })
})
