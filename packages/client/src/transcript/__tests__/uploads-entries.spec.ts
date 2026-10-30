import { describe, expect, it } from 'bun:test'

import { deriveTranscript } from '../derive-transcript'
import { fromTheOperator, log } from './fixture'

const upload = (uploadId: string) => ({
  uploadId,
  pathname: `p/${uploadId}`,
  name: `${uploadId}.pdf`,
  size: 1,
  mediaType: 'application/pdf',
})

describe('operator uploads', () => {
  it('carries uploads on the entry', () => {
    const events = log([{ type: 'user-said', text: 'see', uploads: [upload('a')] }])
    expect(fromTheOperator(deriveTranscript({ events, signals: [] }))[0]?.uploads).toEqual([
      upload('a'),
    ])
  })

  it('concatenates uploads when messages fold into one block', () => {
    const events = log([
      { type: 'user-said', text: 'one', uploads: [upload('a')] },
      { type: 'user-said', text: 'two', uploads: [upload('b')] },
    ])
    const [entry] = fromTheOperator(deriveTranscript({ events, signals: [] }))
    expect(entry?.uploads?.map((item) => item.uploadId)).toEqual(['a', 'b'])
  })
})
