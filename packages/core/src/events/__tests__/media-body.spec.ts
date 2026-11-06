import { describe, expect, it } from 'bun:test'

import { ref } from '../../media/__tests__/media-ref.spec'
import type { EventDraft } from '../body'
import { toCallId } from '../ids'
import { eventBodySchema } from '../schema'

describe('events that carry media', () => {
  it('round-trips a user-said with media', () => {
    const body: EventDraft = {
      type: 'user-said',
      text: 'look',
      media: [{ media: ref, source: '/tmp/shot.png' }, { media: ref }],
    }
    expect(eventBodySchema.parse(JSON.parse(JSON.stringify(body)))).toEqual(body)
  })

  it('round-trips a tool-result whose modelParts include a media part', () => {
    const body: EventDraft = {
      type: 'tool-result',
      callId: toCallId('call-1'),
      name: 'read',
      modelParts: [
        { type: 'text', text: 'shot.png' },
        { type: 'media', media: ref, source: 'shot.png' },
      ],
    }
    expect(eventBodySchema.parse(JSON.parse(JSON.stringify(body)))).toEqual(body)
  })

  it('rejects a media entry whose reference is malformed', () => {
    const body = { type: 'user-said', text: 'x', media: [{ media: { ...ref, hash: 'nope' } }] }
    expect(eventBodySchema.safeParse(body).success).toBe(false)
  })
})
