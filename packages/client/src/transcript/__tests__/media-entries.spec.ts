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
  it('carries media on the entry, and keeps a media-only message', () => {
    const events = log([{ type: 'user-said', text: '', media: [media(HASH_A)] }])
    expect(fromTheOperator(deriveTranscript({ events, signals: [] }))[0]?.media).toEqual([
      media(HASH_A),
    ])
  })

  it('defaults to no media', () => {
    const events = log([{ type: 'user-said', text: 'hi' }])
    expect(fromTheOperator(deriveTranscript({ events, signals: [] }))[0]?.media).toEqual([])
  })

  it('concatenates media when messages fold into one block', () => {
    const events = log([
      { type: 'user-said', text: 'one', media: [media(HASH_A)] },
      { type: 'user-said', text: 'two', media: [media(HASH_B)] },
    ])
    const [entry] = fromTheOperator(deriveTranscript({ events, signals: [] }))
    expect(entry?.media?.map((item) => item.media.hash)).toEqual([HASH_A, HASH_B])
  })
})
