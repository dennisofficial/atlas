import { describe, expect, it } from 'bun:test'
import {
  chainEvents,
  ERunFailureKind,
  ESessionStatus,
  toRunId,
  toThreadId,
  type V2Body,
} from '@dltech/atlas-core'
import { inboxMessageSchema } from '@dltech/atlas-protocol'
import { NOW, setupSessionsService as setup } from './sessions.service.fixture'

describe('SessionsService status and events', () => {
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
