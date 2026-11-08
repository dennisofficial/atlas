import { describe, expect, it } from 'bun:test'

import { EAttachmentStore, type Attachment } from '../attachment'
import { attachmentsOf } from '../from-said'
import { uploadsOf } from '../uploads-of'

const stored: Attachment = {
  id: 'up-1',
  name: 'shot.png',
  mediaType: 'image/png',
  size: 5,
  content: {
    store: EAttachmentStore.Upload,
    uploadId: 'up-1',
    pathname: 'u/up-1/shot.png',
    inline: 'aGk=',
  },
}

describe('attachmentsOf with an attachments field', () => {
  it('returns attachments and ignores the legacy fields', () => {
    const all = attachmentsOf({
      attachments: [stored],
      images: [{ path: 'other.png', mediaType: 'image/png', data: 'aGk=' }],
      files: [{ path: 'a.txt', mediaType: 'text/plain', data: 'aGk=' }],
    })
    expect(all).toEqual([stored])
  })

  it('falls back to the legacy fields when attachments is empty', () => {
    const all = attachmentsOf({
      attachments: [],
      images: [{ path: 'other.png', mediaType: 'image/png', data: 'aGk=' }],
    })
    expect(all.map((entry) => entry.name)).toEqual(['other.png'])
  })
})

describe('uploadsOf', () => {
  it('lists the upload store entries only', () => {
    const inline: Attachment = {
      ...stored,
      id: 'i',
      content: { store: EAttachmentStore.Inline, data: 'aGk=' },
    }
    expect(uploadsOf([inline, stored])).toEqual([
      {
        uploadId: 'up-1',
        pathname: 'u/up-1/shot.png',
        name: 'shot.png',
        size: 5,
        mediaType: 'image/png',
      },
    ])
  })
})
