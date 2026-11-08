import { EAttachmentStore } from '@dltech/atlas-core'
import { describe, expect, it } from 'bun:test'

import { deriveTranscript } from '../derive-transcript'
import { fromTheOperator, log } from './fixture'

const media = (hash: string) => ({
  media: {
    hash,
    mediaType: 'image/png' as const,
    size: 1,
    width: 1,
    height: 1,
  },
  source: `${hash.slice(0, 1)}.png`,
})
const HASH_A = 'a'.repeat(64)
const HASH_B = 'b'.repeat(64)

describe('operator media', () => {
  it('carries media as an attachment, and keeps a media-only message', () => {
    const events = log([{ type: 'user-said', text: '', media: [media(HASH_A)] }])
    expect(fromTheOperator(deriveTranscript({ events, signals: [] }))[0]?.attachments).toEqual([
      {
        id: `media:0:${HASH_A}`,
        name: 'a.png',
        mediaType: 'image/png',
        size: 1,
        source: 'a.png',
        content: { store: EAttachmentStore.Media, hash: HASH_A },
        image: { width: 1, height: 1 },
      },
    ])
  })

  it('defaults to no attachments', () => {
    const events = log([{ type: 'user-said', text: 'hi' }])
    expect(fromTheOperator(deriveTranscript({ events, signals: [] }))[0]?.attachments).toEqual([])
  })

  it('concatenates attachments when messages fold into one block', () => {
    const events = log([
      { type: 'user-said', text: 'one', media: [media(HASH_A)] },
      { type: 'user-said', text: 'two', media: [media(HASH_B)] },
    ])
    const [entry] = fromTheOperator(deriveTranscript({ events, signals: [] }))
    expect(entry?.attachments.map((attachment) => attachment.name)).toEqual(['a.png', 'b.png'])
  })
})
