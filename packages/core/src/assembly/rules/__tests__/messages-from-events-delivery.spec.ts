import { describe, expect, it } from 'bun:test'

import { EAttachmentStore, type Attachment } from '../../../attachments/attachment'
import type { ImageCapabilities } from '../../../images/delivery'
import { MAX_INLINE_BYTES } from '../../../images/limits'
import { EUploadState } from '../../../uploads/placement'
import type { Assembled } from '../../assembled'
import { contextFor, log, operatorSaidAs } from '../../__tests__/log-fixture'
import { messagesFromEvents } from '../messages-from-events'

const empty: Assembled = { system: [], messages: [] }

const inlineModel: ImageCapabilities = { images: 'inline', maxInlineBytes: MAX_INLINE_BYTES }
const urlModel: ImageCapabilities = { images: 'both', maxInlineBytes: MAX_INLINE_BYTES }
const blindModel: ImageCapabilities = { images: 'none', maxInlineBytes: MAX_INLINE_BYTES }

const HASH = 'a'.repeat(64)
const UPLOAD_ID = '11111111-1111-4111-8111-111111111111'

const upload: Attachment = {
  id: UPLOAD_ID,
  name: 'shot.png',
  mediaType: 'image/png',
  size: 8,
  content: {
    store: EAttachmentStore.Upload,
    uploadId: UPLOAD_ID,
    pathname: 'composer-uploads/u/x/shot.png',
    inline: 'iVBORw0KGgo=',
  },
  image: { width: 4, height: 3 },
}

const media: Attachment = {
  id: `media:${HASH}`,
  name: 'photo.png',
  mediaType: 'image/png',
  size: 8,
  content: { store: EAttachmentStore.Media, hash: HASH },
  image: { width: 4, height: 3 },
}

const urls = new Map([
  [`upload:${UPLOAD_ID}`, 'https://blob.test/upload'],
  [`media:${HASH}`, 'https://blob.test/media'],
])

const READY_AT = { state: EUploadState.Ready as const, path: '/atlas/home/uploads/shot.png' }

const contentOf = ({
  attachment,
  imageCapabilities,
  mediaUrls,
}: {
  attachment: Attachment
  imageCapabilities?: ImageCapabilities
  mediaUrls?: ReadonlyMap<string, string>
}) =>
  messagesFromEvents()(empty, {
    ...contextFor({
      events: log([{ type: 'user-said', text: 'look', attachments: [attachment] }]),
    }),
    imageCapabilities,
    mediaUrls,
  }).messages[0]?.message.content

const shown = { mediaType: 'image/png', width: 4, height: 3 }

describe('delivering one picture per the model that reads it', () => {
  it('sends an upload with a copy as inline data to an inline-only model', () => {
    expect(
      contentOf({ attachment: upload, imageCapabilities: inlineModel, mediaUrls: urls })?.[2],
    ).toEqual({
      type: 'image',
      bytes: { kind: 'inline', data: 'iVBORw0KGgo=' },
      source: 'shot.png',
      ...shown,
    })
  })

  it('sends the same upload as a signed url to a url-capable model', () => {
    expect(
      contentOf({ attachment: upload, imageCapabilities: urlModel, mediaUrls: urls })?.[2],
    ).toEqual({
      type: 'image',
      bytes: { kind: 'url', url: 'https://blob.test/upload' },
      source: 'shot.png',
      ...shown,
    })
  })

  it('names a picture it cannot show and cannot place as unavailable, never as a path', () => {
    const content = contentOf({
      attachment: upload,
      imageCapabilities: blindModel,
      mediaUrls: urls,
    })

    expect(content?.[0]).toEqual({
      type: 'text',
      text: operatorSaidAs('look\n[image unavailable: shot.png]'),
    })
    expect(content?.some((part) => part.type === 'image')).toBe(false)
  })

  it('names a placed upload by the path the sandbox really has', () => {
    const content = messagesFromEvents()(empty, {
      ...contextFor({
        events: log([{ type: 'user-said', text: 'look', attachments: [upload] }]),
      }),
      imageCapabilities: blindModel,
      uploads: new Map([['11111111-1111-4111-8111-111111111111', READY_AT]]),
    }).messages[0]?.message.content

    expect(content?.[0]).toEqual({
      type: 'text',
      text: operatorSaidAs('look\n[image /atlas/home/uploads/shot.png · 4×3]'),
    })
  })

  it('shows a media-store attachment as a url picture to a url-capable model', () => {
    expect(
      contentOf({ attachment: media, imageCapabilities: urlModel, mediaUrls: urls })?.[2],
    ).toEqual({
      type: 'image',
      bytes: { kind: 'url', url: 'https://blob.test/media' },
      source: 'photo.png',
      ...shown,
    })
  })

  it('leaves a stored picture to the host when the model takes only inline bytes', () => {
    expect(
      contentOf({ attachment: media, imageCapabilities: inlineModel, mediaUrls: urls })?.[2],
    ).toEqual({
      type: 'media',
      media: { hash: HASH, mediaType: 'image/png', size: 8, width: 4, height: 3 },
    })
  })

  it('leaves a stored picture to the host when no url could be signed here', () => {
    expect(contentOf({ attachment: media, imageCapabilities: urlModel })?.[2]).toMatchObject({
      type: 'media',
      media: { hash: HASH },
    })
  })

  it('keeps today’s inline behaviour when no capabilities are given', () => {
    expect(contentOf({ attachment: upload })?.[2]).toMatchObject({
      type: 'image',
      bytes: { kind: 'inline', data: 'iVBORw0KGgo=' },
    })
  })
})
