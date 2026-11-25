import { describe, expect, it } from 'bun:test'

import { setupSessionsService as setup } from './sessions.service.fixture'

describe('SessionsService.retry', () => {
  it('carries the agent the caller names', async () => {
    const { plane, service } = setup()
    const created = await service.create({ userId: 'user-a', projectId: 'proj-a' })
    await plane.createThread({ threadId: 'child-thread', sessionId: created.sessionId })

    const { inboxId } = await service.retry({
      userId: 'user-a',
      sessionId: created.sessionId,
      agentId: 'child-thread',
    })

    const entry = await plane.readInboxEntry({ sessionId: created.sessionId, inboxId })
    expect(entry).toMatchObject({ kind: 'retry', payload: '{"agentId":"child-thread"}' })
  })

  it('keeps the payload empty when the caller names no agent', async () => {
    const { plane, service } = setup()
    const created = await service.create({ userId: 'user-a', projectId: 'proj-a' })

    const { inboxId } = await service.retry({ userId: 'user-a', sessionId: created.sessionId })

    const entry = await plane.readInboxEntry({ sessionId: created.sessionId, inboxId })
    expect(entry).toMatchObject({ kind: 'retry', payload: '{}' })
  })

  it('refuses an agent of another session', async () => {
    const { plane, service } = setup()
    const mine = await service.create({ userId: 'user-a', projectId: 'proj-a' })
    const other = await service.create({ userId: 'user-a', projectId: 'proj-a' })
    await plane.createThread({ threadId: 'other-child', sessionId: other.sessionId })

    await expect(
      service.retry({
        userId: 'user-a',
        sessionId: mine.sessionId,
        agentId: 'other-child',
      }),
    ).rejects.toThrow('agent not found')
    const inbox = await plane.readInbox({ sessionId: mine.sessionId, afterId: 0, limit: 10 })
    expect(inbox.some((entry) => entry.kind === 'retry')).toBe(false)
  })

  it('refuses an agent that does not exist', async () => {
    const { service } = setup()
    const created = await service.create({ userId: 'user-a', projectId: 'proj-a' })

    await expect(
      service.retry({ userId: 'user-a', sessionId: created.sessionId, agentId: 'missing' }),
    ).rejects.toThrow('agent not found')
  })
})
