import { describe, expect, it } from 'bun:test'

import { EAttachmentStore, type Attachment } from '@dltech/atlas-core'

import { stagedAttachmentsOf } from '../use-session-send'

const shot: Attachment = {
  id: 'shot-1',
  name: 'shot.png',
  mediaType: 'image/png',
  size: 12,
  content: { store: EAttachmentStore.Inline, data: 'AAAA' },
}

describe('stagedAttachmentsOf', () => {
  it('stages the uploads with the media the composer holds', () => {
    const staged = stagedAttachmentsOf({
      media: [shot],
      uploads: [
        {
          uploadId: 'u-1',
          name: 'notes.pdf',
          mediaType: 'application/pdf',
          pathname: 'uploads/u-1',
          size: 40,
        },
      ],
    })

    expect(staged.map((attachment) => attachment.id)).toEqual(['shot-1', 'u-1'])
    expect(staged[0]).toEqual(shot)
    expect(staged[1]?.name).toBe('notes.pdf')
  })
})
