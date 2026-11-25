import { describe, expect, it } from 'bun:test'
import { chainHash, toCallId, type RecordEvent } from '@dltech/atlas-core'

import { memorySessionLog } from '../session-log'
import { createSessionFollower } from '../session-follower'
import { createFakeScheduler, eventsMessage, headOf, mintEvents } from './support'

const setup = () => {
  const clock = createFakeScheduler()
  const follower = createSessionFollower({
    sessionId: 'session-1',
    log: memorySessionLog(),
    scheduler: clock.scheduler,
    onResnap: () => undefined,
  })
  return { follower }
}

describe('the session follower with withheld pictures', () => {
  it('resumes from the page cursor the server sent, not from a hash of the withheld picture', () => {
    const { follower } = setup()
    const events = mintEvents({
      bodies: [
        { type: 'user-said', text: 'a' },
        {
          type: 'tool-result',
          callId: toCallId('call-1'),
          name: 'read',
          output: {},
          modelParts: [
            {
              type: 'image',
              bytes: { kind: 'inline', data: 'aGVsbG8=' },
              mediaType: 'image/png',
            },
          ],
        },
      ],
    })
    const stored = headOf(events)
    const projected = events.map(
      (event): RecordEvent =>
        event.type === 'tool-result'
          ? {
              ...event,
              modelParts: [{ type: 'image', bytes: { kind: 'withheld' }, mediaType: 'image/png' }],
            }
          : event,
    )
    follower.handleMessage(
      eventsMessage({ id: 's1', events: projected, live: true, cursor: stored }),
    )

    expect(follower.getSnapshot().cursor).toEqual(stored)
    expect(follower.cursor()).toEqual(stored)
    expect(chainHash(projected[1] as RecordEvent)).not.toBe(stored.hash)
  })
})
