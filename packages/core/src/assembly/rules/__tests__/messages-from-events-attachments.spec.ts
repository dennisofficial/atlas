import { describe, expect, it } from 'bun:test'

import { EAttachmentStore, type Attachment } from '../../../attachments/attachment'
import { EUploadState } from '../../../uploads/placement'
import type { Assembled } from '../../assembled'
import { contextFor, log, operatorSaidAs } from '../../__tests__/log-fixture'
import { messagesFromEvents } from '../messages-from-events'

const empty: Assembled = { system: [], messages: [] }

const contentOf = (
  attachments: Attachment[],
  placements?: Map<string, { state: EUploadState.Ready; path: string }>,
) => {
  const base = contextFor({
    events: log([{ type: 'user-said', text: 'look', attachments }]),
  })
  const ctx = placements === undefined ? base : { ...base, uploads: placements }
  return messagesFromEvents()(empty, ctx).messages[0]?.message.content
}

const inlinePicture: Attachment = {
  id: 'a',
  name: 'shot.png',
  mediaType: 'image/png',
  size: 8,
  content: { store: EAttachmentStore.Inline, data: 'iVBORw0KGgo=' },
  image: { width: 4, height: 3 },
}

describe('a message carrying attachments', () => {
  it('shows an inline picture as an image part', () => {
    expect(contentOf([inlinePicture])).toEqual([
      { type: 'text', text: operatorSaidAs('look') },
      {
        type: 'image',
        data: 'iVBORw0KGgo=',
        mediaType: 'image/png',
        source: 'shot.png',
        width: 4,
        height: 3,
      },
    ])
  })

  it('shows an inline document as a file part', () => {
    const doc: Attachment = {
      ...inlinePicture,
      name: 'a.txt',
      mediaType: 'text/plain',
      image: undefined,
    }
    expect(contentOf([doc])?.[1]).toMatchObject({
      type: 'file',
      filename: 'a.txt',
      data: 'iVBORw0KGgo=',
    })
  })

  it('lists an upload with no preview in the uploads block at its placement', () => {
    const pdf: Attachment = {
      id: 'u1',
      name: 'spec.pdf',
      mediaType: 'application/pdf',
      size: 12595,
      content: {
        store: EAttachmentStore.Upload,
        uploadId: 'u1',
        pathname: 'composer-uploads/u/u1/spec.pdf',
      },
    }
    const content = contentOf(
      [pdf],
      new Map([['u1', { state: EUploadState.Ready, path: '/s/uploads/u1/spec.pdf' }]]),
    )
    expect(content).toHaveLength(2)
    expect(content?.[1]).toMatchObject({ type: 'text' })
    expect(JSON.stringify(content?.[1])).toContain(
      '/s/uploads/u1/spec.pdf (12.3 KB, application/pdf)',
    )
  })

  it('shows a picture that was uploaded and inlined once, and lists the upload', () => {
    const both: Attachment = {
      ...inlinePicture,
      id: 'u2',
      content: {
        store: EAttachmentStore.Upload,
        uploadId: 'u2',
        pathname: 'p',
        inline: 'iVBORw0KGgo=',
      },
    }
    const content = contentOf([both])
    expect(content?.map((part) => part.type)).toEqual(['text', 'text', 'image'])
  })

  it('names a media attachment by path line', () => {
    const media: Attachment = {
      id: 'media:x',
      name: 'cat.png',
      mediaType: 'image/png',
      size: 9,
      content: { store: EAttachmentStore.Media, hash: 'a'.repeat(64) },
      image: { width: 10, height: 20 },
    }
    const content = contentOf([media])
    expect(content?.[0]).toMatchObject({ type: 'text' })
    expect(JSON.stringify(content?.[0])).toContain('[image cat.png · 10×20]')
    expect(content).toHaveLength(1)
  })
})
