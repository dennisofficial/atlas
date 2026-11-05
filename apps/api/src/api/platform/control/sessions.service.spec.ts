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

const NOW = '2026-11-03T12:00:00.000Z'

class FakeProjectAccess extends ProjectAccess {
  async ownerOf(args: { projectId: string }): Promise<string | undefined> {
    return args.projectId === 'proj-a' ? 'user-a' : undefined
  }
}

describe('SessionsService', () => {
  const setup = () => {
    const store = new InMemoryControlStore({ clock: () => NOW })
    store.markHostPresent(9001)
    const plane = new ControlPlane({ store })
    const service = new SessionsService(plane, new FakeProjectAccess())
    return { plane, service }
  }

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

  it('posts a repair-diagram inbox entry for the owner and refuses another user', async () => {
    const { plane, service } = setup()
    const created = await service.create({ userId: 'user-a', projectId: 'proj-a' })
    const repair = {
      sessionId: created.sessionId,
      messageId: 'evt-1',
      source: 'graph TD; A-->B',
      error: 'Parse error',
    }

    const posted = await service.repairDiagram({ userId: 'user-a', ...repair })
    expect(posted.inboxId).toBe(1)
    const inbox = await plane.readInbox({ sessionId: created.sessionId, afterId: 0, limit: 10 })
    expect(inbox[0]?.kind).toBe('repair-diagram')
    expect(JSON.parse(inbox[0]?.payload ?? '')).toEqual({
      messageId: 'evt-1',
      source: 'graph TD; A-->B',
      error: 'Parse error',
    })

    await expect(service.repairDiagram({ userId: 'user-b', ...repair })).rejects.toBeInstanceOf(
      NotFoundException,
    )
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

  it('maps an unconsumed post to sent and a consumed one past it', async () => {
    const { plane, service } = setup()
    const created = await service.create({ userId: 'user-a', projectId: 'proj-a' })
    const seeded = await plane.grant({
      sessionId: created.sessionId,
      hostId: 9000,
    })
    const prepared = await plane.append({
      threadId: created.mainThreadId,
      epoch: seeded.epoch,
      events: chainEvents({
        threadId: toThreadId(created.mainThreadId),
        runId: toRunId('run-0'),
        epoch: seeded.epoch,
        at: NOW,
        bodies: [{ type: 'workspace-prepared' }],
      }),
    })
    expect(prepared.ok).toBe(true)
    await plane.revoke({ sessionId: created.sessionId, wantsHolder: false })
    await service.post({ userId: 'user-a', sessionId: created.sessionId, text: 'hi' })

    const sent = await service.status({ userId: 'user-a', sessionId: created.sessionId })
    expect(sent.state).toBe(ESessionStatus.Sent)
    expect(sent.lease.live).toBe(false)

    const granted = await plane.grant({
      sessionId: created.sessionId,
      hostId: 9001,
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
        from: await plane.head({ threadId: created.mainThreadId }),
      }),
    })
    expect(appended.ok).toBe(true)

    const thinking = await service.status({ userId: 'user-a', sessionId: created.sessionId })
    expect(thinking.state).toBe(ESessionStatus.Thinking)
    expect(thinking.lease).toEqual({ epoch: granted.epoch, holderHostId: 9001, live: true })

    const events = await service.events({ userId: 'user-a', sessionId: created.sessionId })
    expect(events.events).toHaveLength(3)
    expect(events.events[2]).toMatchObject({ type: 'user-said', text: 'hi' })
  })

  it('derives status from the tail of a log longer than one page', async () => {
    const { plane, service } = setup()
    const created = await service.create({ userId: 'user-a', projectId: 'proj-a' })
    const granted = await plane.grant({
      sessionId: created.sessionId,
      hostId: 9001,
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

  it('pages events by bytes through maxBytes', async () => {
    const { plane, service } = setup()
    const created = await service.create({ userId: 'user-a', projectId: 'proj-a' })
    const granted = await plane.grant({
      sessionId: created.sessionId,
      hostId: 9001,
    })
    const bodies: V2Body[] = Array.from({ length: 20 }, (_, i) => ({
      type: 'user-said',
      text: `m${i}${'x'.repeat(300)}`,
    }))
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

    const seen: unknown[] = []
    let afterSeq: number | undefined
    for (let guard = 0; guard < 50; guard += 1) {
      const page = await service.events({
        userId: 'user-a',
        sessionId: created.sessionId,
        afterSeq,
        maxBytes: 2_000,
      })
      expect(page.events.length).toBeGreaterThan(0)
      expect(JSON.stringify(page.events).length).toBeLessThanOrEqual(4_000)
      seen.push(...page.events)
      if (page.next === undefined) break
      afterSeq = page.next
    }
    expect(seen).toHaveLength(20)
  })

  it('replaces a single event over the ceiling with an oversized placeholder', async () => {
    const { plane, service } = setup()
    const created = await service.create({ userId: 'user-a', projectId: 'proj-a' })
    const granted = await plane.grant({
      sessionId: created.sessionId,
      hostId: 9001,
    })
    const appended = await plane.append({
      threadId: created.mainThreadId,
      epoch: granted.epoch,
      events: chainEvents({
        threadId: toThreadId(created.mainThreadId),
        runId: toRunId('run-1'),
        epoch: granted.epoch,
        at: NOW,
        bodies: [{ type: 'user-said', text: 'big-'.repeat(1_300_000) }],
      }),
    })
    expect(appended.ok).toBe(true)

    const page = await service.events({ userId: 'user-a', sessionId: created.sessionId })
    expect(page.events).toHaveLength(1)
    const placeholder = page.events[0] as {
      seq: number
      type: string
      oversized: { bytes: number }
    }
    expect(placeholder.seq).toBe(1)
    expect(placeholder.type).toBe('user-said')
    expect(placeholder.oversized.bytes).toBeGreaterThan(3_500_000)
    expect('text' in placeholder).toBe(false)
    expect(page.next).toBeUndefined()
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

  it('reports preparing for a retry message that sits behind a hundred covered ones', async () => {
    const { plane, service } = setup()
    const created = await service.create({ userId: 'user-a', projectId: 'proj-a' })
    for (let index = 0; index < 100; index += 1) {
      await service.post({ userId: 'user-a', sessionId: created.sessionId, text: `m${index}` })
    }
    const granted = await plane.grant({
      sessionId: created.sessionId,
      hostId: 9001,
    })
    const appended = await plane.append({
      threadId: created.mainThreadId,
      epoch: granted.epoch,
      events: chainEvents({
        threadId: toThreadId(created.mainThreadId),
        runId: toRunId('run-1'),
        epoch: granted.epoch,
        at: NOW,
        bodies: [{ type: 'workspace-prepare-failed', reason: 'clone failed', inboxHead: 100 }],
      }),
    })
    expect(appended.ok).toBe(true)
    const failed = await service.status({ userId: 'user-a', sessionId: created.sessionId })
    expect(failed.state).toBe(ESessionStatus.SetupFailed)

    await service.post({ userId: 'user-a', sessionId: created.sessionId, text: 'retry' })
    const retrying = await service.status({ userId: 'user-a', sessionId: created.sessionId })
    expect(retrying.state).toBe(ESessionStatus.Preparing)
  })
})
