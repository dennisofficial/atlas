import { describe, expect, it } from 'bun:test'

import { EAttachmentStore, MAX_INLINE_BYTES } from '@dltech/atlas-core'

import { EAttachmentStatus, withFailed } from '@dltech/atlas-client/session'

import {
  attachRouteOf,
  attachmentsOf,
  describeBytes,
  EAttachRoute,
  restoredHeldOf,
  sendableOf,
  startedAttachment,
  withMediaReady,
  withPreview,
  withReady,
  type PickedFile,
} from '../attachment-plan'

const HASH = 'a'.repeat(64)

const picked = (name: string, size = 1024): PickedFile => ({
  name,
  size,
  mediaType: 'image/jpeg',
  uri: `file:///${name}`,
})

const uploadOf = (name: string) => ({
  uploadId: '6f1e9a3c-0000-4000-8000-000000000001',
  pathname: `composer-uploads/${name}`,
  name,
  size: 1024,
  mediaType: 'image/jpeg',
})

describe('attachRouteOf', () => {
  it('routes a supported image within the inline ceiling to the media store', () => {
    expect(attachRouteOf(picked('a.jpg'))).toBe(EAttachRoute.Media)
    expect(attachRouteOf(picked('a.png', MAX_INLINE_BYTES))).toBe(EAttachRoute.Media)
  })

  it('routes an image type the media store does not take to the upload store', () => {
    const heic = { ...picked('a.heic'), mediaType: 'image/heic' }
    expect(attachRouteOf(heic)).toBe(EAttachRoute.Upload)
  })

  it('routes a file past the inline ceiling to the upload store', () => {
    expect(attachRouteOf(picked('a.jpg', MAX_INLINE_BYTES + 1))).toBe(EAttachRoute.Upload)
  })

  it('routes a file of unknown size to the upload store', () => {
    expect(attachRouteOf(picked('a.jpg', 0))).toBe(EAttachRoute.Upload)
  })
})

describe('held attachment status', () => {
  const started = startedAttachment({ id: 'one', file: picked('a.jpg') })

  it('projects a ready media hash into a media-store attachment', () => {
    const ready = withMediaReady({ held: [started], id: 'one', hash: HASH })
    expect(ready[0]?.status).toBe(EAttachmentStatus.Ready)
    expect(ready[0]?.progress).toBe(1)
    expect(attachmentsOf(ready)).toEqual([
      {
        id: `media:${HASH}`,
        name: 'a.jpg',
        mediaType: 'image/jpeg',
        size: 1024,
        content: { store: 'media', hash: HASH },
      },
    ])
  })

  it('starts uploading with no upload attached', () => {
    expect(started.status).toBe(EAttachmentStatus.Uploading)
    expect(started.progress).toBe(0)
    expect(attachmentsOf([started])).toEqual([])
  })

  it('projects a ready upload into an upload-store attachment', () => {
    const ready = withReady({ held: [started], id: 'one', upload: uploadOf('a.jpg') })
    expect(attachmentsOf(ready)).toEqual([
      {
        id: uploadOf('a.jpg').uploadId,
        name: 'a.jpg',
        mediaType: 'image/jpeg',
        size: 1024,
        content: {
          store: 'upload',
          uploadId: uploadOf('a.jpg').uploadId,
          pathname: 'composer-uploads/a.jpg',
        },
      },
    ])
  })
})

describe('restoredHeldOf', () => {
  it('makes a ready media attachment out of a restored hash', () => {
    const [held] = restoredHeldOf([
      {
        id: 'media:abc',
        name: 'shot.png',
        mediaType: 'image/png',
        size: 12,
        content: { store: EAttachmentStore.Media, hash: 'abc' },
      },
    ])

    expect(held?.status).toBe(EAttachmentStatus.Ready)
    expect(held?.hash).toBe('abc')
    expect(held?.id).toBe('media:abc')
  })

  it('makes a ready upload attachment out of a restored upload', () => {
    const [held] = restoredHeldOf([
      {
        id: 'up-1',
        name: 'notes.pdf',
        mediaType: 'application/pdf',
        size: 24,
        content: {
          store: EAttachmentStore.Upload,
          uploadId: 'up-1',
          pathname: 'u/up-1/notes.pdf',
        },
      },
    ])

    expect(held?.status).toBe(EAttachmentStatus.Ready)
    expect(held?.upload?.uploadId).toBe('up-1')
  })

  it('drops an inline attachment the composer cannot hold', () => {
    expect(
      restoredHeldOf([
        {
          id: 'shot-1',
          name: 'shot.png',
          mediaType: 'image/png',
          size: 12,
          content: { store: EAttachmentStore.Inline, data: 'AAAA' },
        },
      ]),
    ).toEqual([])
  })
})

describe('sendableOf', () => {
  const ready = withReady({
    held: [startedAttachment({ id: 'one', file: picked('a.jpg') })],
    id: 'one',
    upload: uploadOf('a.jpg'),
  })

  it('sends text alone', () => {
    expect(sendableOf({ text: 'hello', held: [] })).toBe(true)
  })

  it('sends a ready attachment without a caption', () => {
    expect(sendableOf({ text: '', held: ready })).toBe(true)
  })

  it('refuses whitespace with no attachment', () => {
    expect(sendableOf({ text: '   ', held: [] })).toBe(false)
  })

  it('refuses while an upload is in flight or failed', () => {
    const uploading = [startedAttachment({ id: 'one', file: picked('a.jpg') })]
    expect(sendableOf({ text: 'hello', held: uploading })).toBe(false)
    expect(sendableOf({ text: 'hello', held: withFailed({ held: uploading, id: 'one' }) })).toBe(
      false,
    )
  })
})

describe('describeBytes', () => {
  it('rounds to a readable unit', () => {
    expect(describeBytes(512)).toBe('512 B')
    expect(describeBytes(2048)).toBe('2.0 KB')
    expect(describeBytes(5 * 1024 * 1024)).toBe('5.0 MB')
    expect(describeBytes(100 * 1024 * 1024)).toBe('100 MB')
  })
})

describe('withPreview', () => {
  it('sets the preview uri of one held attachment only', () => {
    const held = restoredHeldOf([
      {
        id: 'media:a',
        name: 'a.png',
        mediaType: 'image/png',
        size: 1,
        content: { store: EAttachmentStore.Media, hash: 'a' },
      },
      {
        id: 'media:b',
        name: 'b.png',
        mediaType: 'image/png',
        size: 1,
        content: { store: EAttachmentStore.Media, hash: 'b' },
      },
    ])
    const next = withPreview({ held, id: 'media:a', uri: 'https://media/a' })
    expect(next.map((entry) => entry.uri)).toEqual(['https://media/a', ''])
  })
})
