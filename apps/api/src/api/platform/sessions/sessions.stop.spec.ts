import { describe, expect, it } from 'bun:test'
import { setupSessionsService as setup } from './sessions.service.fixture'

describe('SessionsService.stop', () => {
  it('posts one stop entry for the owner', async () => {
    const { plane, service } = setup()
    const created = await service.create({ userId: 'user-a', projectId: 'proj-a' })

    const { inboxId } = await service.stop({ userId: 'user-a', sessionId: created.sessionId })

    const entry = await plane.readInboxEntry({ sessionId: created.sessionId, inboxId })
    expect(entry).toMatchObject({ kind: 'stop', payload: '{}' })
    const inbox = await plane.readInbox({ sessionId: created.sessionId, afterId: 0, limit: 10 })
    expect(inbox.filter((row) => row.kind === 'stop')).toHaveLength(1)
  })

  it("refuses another user's stop", async () => {
    const { plane, service } = setup()
    const created = await service.create({ userId: 'user-a', projectId: 'proj-a' })

    await expect(service.stop({ userId: 'user-b', sessionId: created.sessionId })).rejects.toThrow(
      'session not found',
    )
    const inbox = await plane.readInbox({ sessionId: created.sessionId, afterId: 0, limit: 10 })
    expect(inbox.some((row) => row.kind === 'stop')).toBe(false)
  })
})
