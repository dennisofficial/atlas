import { EAttachmentStore } from '@dltech/atlas-core'
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
  it('carries an upload as an attachment', () => {
    const events = log([{ type: 'user-said', text: 'see', uploads: [upload('a')] }])
    expect(fromTheOperator(deriveTranscript({ events, signals: [] }))[0]?.attachments).toEqual([
      {
        id: 'a',
        name: 'a.pdf',
        mediaType: 'application/pdf',
        size: 1,
        content: { store: EAttachmentStore.Upload, uploadId: 'a', pathname: 'p/a' },
      },
    ])
  })

  it('concatenates attachments when messages fold into one block', () => {
    const events = log([
      { type: 'user-said', text: 'one', uploads: [upload('a')] },
      { type: 'user-said', text: 'two', uploads: [upload('b')] },
    ])
    const [entry] = fromTheOperator(deriveTranscript({ events, signals: [] }))
    expect(entry?.attachments.map((attachment) => attachment.id)).toEqual(['a', 'b'])
  })
})
