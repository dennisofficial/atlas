import { describe, expect, it } from 'bun:test'

import type { SaidImage, SaidUpload } from '../../events/body'
import { EAttachmentStore, inlineData, mediaHashOf } from '../attachment'
import { attachmentsOf } from '../from-said'

const shot: SaidImage = {
  path: 'shot.png',
  mediaType: 'image/png',
  data: 'aGVsbG8=',
  width: 4,
  height: 3,
}

const upload = (over: Partial<SaidUpload> = {}): SaidUpload => ({
  uploadId: 'up-1',
  pathname: 'u/up-1/image.png',
  name: 'image.png',
  size: 12,
  mediaType: 'image/png',
  ...over,
})

describe('attachmentsOf', () => {
  it('carries a pasted picture inline, named by its basename', () => {
    const [only, ...rest] = attachmentsOf({ images: [shot] })
    expect(rest).toEqual([])
    expect(only).toMatchObject({
      id: 'image:0',
      name: 'shot.png',
      mediaType: 'image/png',
      content: { store: EAttachmentStore.Inline },
      image: { width: 4, height: 3 },
    })
    expect(inlineData(only!)).toBe('aGVsbG8=')
  })

  it('merges a picture with the upload it was sent as, keeping one attachment', () => {
    const all = attachmentsOf({
      images: [{ ...shot, path: 'image.png' }],
      uploads: [upload()],
    })
    expect(all).toHaveLength(1)
    expect(all[0]).toMatchObject({
      id: 'up-1',
      name: 'image.png',
      size: 12,
      content: { store: EAttachmentStore.Upload, uploadId: 'up-1', inline: 'aGVsbG8=' },
    })
    expect(inlineData(all[0]!)).toBe('aGVsbG8=')
  })

  it('consumes only the first upload a picture names', () => {
    const all = attachmentsOf({
      images: [{ ...shot, path: 'image.png' }],
      uploads: [upload(), upload({ uploadId: 'up-2', pathname: 'u/up-2/image.png' })],
    })
    expect(all.map((attachment) => attachment.id)).toEqual(['up-1', 'up-2'])
  })

  it('carries a non-image file inline under its filename', () => {
    const all = attachmentsOf({
      files: [
        {
          path: 'spec/copy.pdf',
          mediaType: 'application/pdf',
          data: 'aGVsbG8=',
          filename: 'copy.pdf',
        },
      ],
    })
    expect(all[0]).toMatchObject({
      id: 'file:0',
      name: 'copy.pdf',
      mediaType: 'application/pdf',
      content: { store: EAttachmentStore.Inline },
    })
  })

  it('keeps an upload that no picture covers', () => {
    const all = attachmentsOf({
      uploads: [upload({ name: 'notes.md', mediaType: 'text/markdown' })],
    })
    expect(all[0]).toMatchObject({
      id: 'up-1',
      name: 'notes.md',
      content: { store: EAttachmentStore.Upload },
    })
  })

  it('orders pictures, then files, then uploads, then media', () => {
    const all = attachmentsOf({
      uploads: [upload({ uploadId: 'up-9', name: 'later.md', mediaType: 'text/markdown' })],
      images: [shot],
      files: [{ path: 'a.txt', mediaType: 'text/plain', data: 'aGk=' }],
      media: [
        {
          media: { hash: 'h'.repeat(64), mediaType: 'image/png', size: 9, width: 2, height: 2 },
          source: 'shot.png',
        },
      ],
    })
    expect(all.map((attachment) => attachment.name)).toEqual([
      'shot.png',
      'a.txt',
      'later.md',
      'shot.png',
    ])
    expect(mediaHashOf(all[3]!)).toBe('h'.repeat(64))
  })

  it('names a media attachment by its hash when no source is given', () => {
    const hash = 'h'.repeat(64)
    const all = attachmentsOf({
      media: [{ media: { hash, mediaType: 'image/png', size: 9, width: 2, height: 2 } }],
    })
    expect(all[0]).toMatchObject({ name: hash, content: { store: EAttachmentStore.Media, hash } })
  })

  it('has nothing to show for a message with no attachments', () => {
    expect(attachmentsOf({})).toEqual([])
  })
})
