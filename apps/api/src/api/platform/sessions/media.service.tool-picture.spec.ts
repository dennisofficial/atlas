import { describe, expect, it } from 'bun:test'
import { NotFoundException } from '@nestjs/common'
import { toCallId } from '@dltech/atlas-core'
import { setupMedia } from './media.fixture'
import { appendBodies } from './sessions.service.fixture'

describe('MediaService.toolPicture', () => {
  const DATA = 'aGVsbG8td29ybGQ='

  const seeded = async () => {
    const ctx = setupMedia()
    const created = await ctx.sessionsService.create({ userId: 'user-a', projectId: 'proj-a' })
    const granted = await ctx.plane.grant({ sessionId: created.sessionId, hostId: 9001 })
    await appendBodies({
      plane: ctx.plane,
      threadId: created.mainThreadId,
      epoch: granted.epoch,
      bodies: [
        {
          type: 'tool-result',
          callId: toCallId('call-1'),
          name: 'read',
          output: {},
          modelParts: [
            { type: 'text', text: 'shot.png' },
            { type: 'image', bytes: { kind: 'inline', data: DATA }, mediaType: 'image/png' },
          ],
        },
      ],
    })
    return { ...ctx, sessionId: created.sessionId, threadId: created.mainThreadId, seq: 1 }
  }

  it('returns the inline picture the thread event carries to the owner', async () => {
    const { service, sessionId, threadId, seq } = await seeded()

    expect(
      await service.toolPicture({ userId: 'user-a', sessionId, threadId, seq, part: 1 }),
    ).toEqual({ mediaType: 'image/png', data: DATA })
  })

  it('refuses a session that belongs to someone else', async () => {
    const { service, sessionId, threadId, seq } = await seeded()

    await expect(
      service.toolPicture({ userId: 'user-b', sessionId, threadId, seq, part: 1 }),
    ).rejects.toBeInstanceOf(NotFoundException)
  })

  it('answers not found for a part that carries no inline picture', async () => {
    const { service, sessionId, threadId, seq } = await seeded()

    await expect(
      service.toolPicture({ userId: 'user-a', sessionId, threadId, seq, part: 0 }),
    ).rejects.toBeInstanceOf(NotFoundException)
  })

  it('answers not found for a seq that names no event', async () => {
    const { service, sessionId, threadId } = await seeded()

    await expect(
      service.toolPicture({ userId: 'user-a', sessionId, threadId, seq: 9, part: 1 }),
    ).rejects.toBeInstanceOf(NotFoundException)
  })
})
