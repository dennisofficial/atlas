import { EAttachmentStore, type Attachment } from '@dltech/atlas-core'
import { describe, expect, it } from 'bun:test'

import { draftContentOf } from '../composer-draft-content'

const stored = (hash: string): Attachment => ({
  id: hash,
  name: `${hash}.png`,
  mediaType: 'image/png',
  size: 1024,
  content: { store: EAttachmentStore.Media, hash },
})

const uploaded = (uploadId: string): Attachment => ({
  id: uploadId,
  name: `${uploadId}.pdf`,
  mediaType: 'application/pdf',
  size: 2048,
  content: { store: EAttachmentStore.Upload, uploadId, pathname: `composer-uploads/${uploadId}` },
})

describe('draftContentOf', () => {
  it('carries restored attachments ahead of the ones this composer holds', () => {
    const content = draftContentOf({
      text: 'keep it',
      carried: [stored('a')],
      attachments: [uploaded('u1')],
    })
    expect(content).toEqual({ text: 'keep it', attachments: [stored('a'), uploaded('u1')] })
  })

  it('keeps restored attachments when the phone adds no attachments and no text', () => {
    const content = draftContentOf({
      text: '',
      carried: [stored('a'), stored('b')],
      attachments: [],
    })
    expect(content).toEqual({ text: '', attachments: [stored('a'), stored('b')] })
    expect(content.attachments).toHaveLength(2)
  })

  it('sends only this composer attachments when nothing was restored', () => {
    const content = draftContentOf({ text: 'hello', carried: [], attachments: [uploaded('u1')] })
    expect(content).toEqual({ text: 'hello', attachments: [uploaded('u1')] })
  })

  it('is empty when nothing was restored and nothing was typed', () => {
    const content = draftContentOf({ text: '', carried: [], attachments: [] })
    expect(content).toEqual({ text: '', attachments: [] })
  })
})
