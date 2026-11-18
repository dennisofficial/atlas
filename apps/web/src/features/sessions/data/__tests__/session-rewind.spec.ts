import { describe, expect, it } from 'bun:test'
import { chainEvents, toRunId, toThreadId, type V2Body } from '@dltech/atlas-core'

import {
  mergedDraftOf,
  requestRewind,
  restorePlanOf,
  rewindLanded,
  rewindRefused,
  rewoundMessageOf,
  seqByEventIdOf,
} from '../session-rewind'
import { restoredMediaOf } from '../session-media'

const eventsOf = (bodies: readonly V2Body[]) =>
  chainEvents({
    threadId: toThreadId('thread-1'),
    runId: toRunId('run-1'),
    epoch: 1,
    at: '2026-11-05T10:00:00.000Z',
    from: undefined,
    bodies,
  })

const said = (text: string): V2Body => ({ type: 'user-said', text })

describe('session rewind', () => {
  it('maps user messages to their sequence', () => {
    const events = eventsOf([
      said('a'),
      { type: 'assistant-said', parts: [{ type: 'text', text: 'b' }] },
      said('c'),
    ])
    expect([...seqByEventIdOf(events).values()]).toEqual([1, 3])
  })

  it('posts the rewind command with the sequence only', async () => {
    const calls: unknown[] = []
    const inboxId = await requestRewind({
      api: {
        command: (input) => {
          calls.push(input)
          return Promise.resolve({ inboxId: 7 })
        },
      },
      sessionId: 's1',
      toSeq: 3,
    })
    expect(calls).toEqual([{ sessionId: 's1', name: 'rewind', args: { toSeq: 3 } }])
    expect(inboxId).toBe(7)
  })

  describe('rewoundMessageOf', () => {
    it('keeps the text and attachments of the picked message', () => {
      const events = eventsOf([
        said('a'),
        {
          type: 'user-said',
          text: 'b',
          attachments: [
            {
              id: 'm1',
              name: 'shot.png',
              mediaType: 'image/png',
              size: 10,
              content: { store: 'media', hash: 'h1' },
            },
          ],
        },
      ])
      const picked = events[1]
      if (picked === undefined) throw new Error('missing')
      expect(rewoundMessageOf({ events, eventId: picked.id })).toMatchObject({
        eventId: picked.id,
        toSeq: 2,
        text: 'b',
        attachments: [{ id: 'm1', content: { store: 'media', hash: 'h1' } }],
      })
    })

    it('ignores anything that is not a user message', () => {
      const events = eventsOf([{ type: 'assistant-said', parts: [{ type: 'text', text: 'x' }] }])
      expect(rewoundMessageOf({ events, eventId: events[0]?.id ?? '' })).toBeUndefined()
    })
  })

  it('lands once the picked message leaves the window', () => {
    const events = eventsOf([said('a'), said('b')])
    const picked = events[1]
    if (picked === undefined) throw new Error('missing')
    expect(rewindLanded({ events, eventId: picked.id })).toBe(false)
    expect(rewindLanded({ events: events.slice(0, 1), eventId: picked.id })).toBe(true)
  })

  it('sees a refusal of its own command only', () => {
    const events = eventsOf([{ type: 'input-refused', inboxId: 4, reason: 'no' }])
    expect(rewindRefused({ events, inboxId: 4 })).toBe(true)
    expect(rewindRefused({ events, inboxId: 5 })).toBe(false)
  })

  describe('mergedDraftOf', () => {
    it('fills an empty composer with the rewound text', () => {
      expect(mergedDraftOf({ rewound: 'again', current: '' })).toBe('again')
      expect(mergedDraftOf({ rewound: 'again', current: '  ' })).toBe('again')
    })

    it('puts the rewound text ahead of what is already typed', () => {
      expect(mergedDraftOf({ rewound: 'again', current: 'typed' })).toBe('again\n\ntyped')
      expect(mergedDraftOf({ rewound: '', current: 'typed' })).toBe('typed')
    })
  })

  describe('restorePlanOf', () => {
    it('routes media, uploads and inline images back to their composer stores', () => {
      const plan = restorePlanOf([
        {
          id: 'm',
          name: 'shot.png',
          mediaType: 'image/png',
          size: 3,
          content: { store: 'media', hash: 'h', inline: 'AAA' },
        },
        {
          id: 'u',
          name: 'doc.pdf',
          mediaType: 'application/pdf',
          size: 9,
          content: { store: 'upload', uploadId: 'u', pathname: 'p/doc.pdf' },
        },
        {
          id: 'i',
          name: 'pic.png',
          mediaType: 'image/png',
          size: 3,
          image: { width: 4, height: 5 },
          content: { store: 'inline', data: 'BBB' },
        },
      ])
      expect(plan.media).toEqual([
        { hash: 'h', name: 'shot.png', mediaType: 'image/png', size: 3, inline: 'AAA' },
      ])
      expect(plan.uploads).toEqual([
        {
          uploadId: 'u',
          pathname: 'p/doc.pdf',
          name: 'doc.pdf',
          size: 9,
          mediaType: 'application/pdf',
        },
      ])
      expect(plan.images).toEqual([
        { path: 'pic.png', mediaType: 'image/png', data: 'BBB', width: 4, height: 5 },
      ])
    })
  })

  it('restores stored media as ready to send', () => {
    expect(
      restoredMediaOf({
        id: 'x',
        item: { hash: 'h', name: 'shot.png', mediaType: 'image/png', size: 3, inline: 'AAA' },
      }),
    ).toMatchObject({
      id: 'x',
      status: 'ready',
      hash: 'h',
      previewUrl: 'data:image/png;base64,AAA',
    })
  })
})
