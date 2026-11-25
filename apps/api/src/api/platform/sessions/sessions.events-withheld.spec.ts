import { describe, expect, it } from 'bun:test'
import { toCallId } from '@dltech/atlas-core'
import { appendBodies, setupSessionsService } from './sessions.service.fixture'

describe('sessions.events egress', () => {
  it('withholds an inline picture instead of replaying its bytes', async () => {
    const fixture = setupSessionsService()
    const created = await fixture.service.create({ userId: 'user-a', projectId: 'proj-a' })
    const granted = await fixture.plane.grant({ sessionId: created.sessionId, hostId: 9001 })
    await appendBodies({
      plane: fixture.plane,
      threadId: created.mainThreadId,
      epoch: granted.epoch,
      bodies: [
        {
          type: 'tool-result',
          callId: toCallId('call-1'),
          name: 'read',
          output: {},
          modelParts: [
            {
              type: 'image',
              bytes: { kind: 'inline', data: 'A'.repeat(3_400_000) },
              mediaType: 'image/png',
            },
          ],
        },
      ],
    })

    const page = await fixture.service.events({
      userId: 'user-a',
      sessionId: created.sessionId,
      maxBytes: Number.MAX_SAFE_INTEGER,
    })
    const event = page.events[0] as { type?: string; modelParts?: unknown[] }

    expect(event.type).toBe('tool-result')
    expect(event.modelParts).toEqual([
      { type: 'image', bytes: { kind: 'withheld' }, mediaType: 'image/png' },
    ])
    expect(Buffer.byteLength(JSON.stringify(page), 'utf8')).toBeLessThan(64 * 1024)
  })
})
