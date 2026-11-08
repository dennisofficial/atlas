import { describe, expect, it } from 'bun:test'

import { EAttachmentStore, type Attachment } from '../../../attachments/attachment'
import type { ImageCapabilities } from '../../../images/delivery'
import { MAX_INLINE_BYTES } from '../../../images/limits'
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

  it('names the same picture as a path line for a model with no vision', () => {
    const content = contentOf({
      attachment: upload,
      imageCapabilities: blindModel,
      mediaUrls: urls,
    })

    expect(content?.[0]).toEqual({
      type: 'text',
      text: operatorSaidAs('look\n[image shot.png · 4×3]'),
    })
    expect(content?.some((part) => part.type === 'image')).toBe(false)
  })

  it('shows a media-store attachment as a url picture to a url-capable model', () => {
    expect(
      contentOf({ attachment: media, imageCapabilities: urlModel, mediaUrls: urls })?.[1],
    ).toEqual({
      type: 'image',
      bytes: { kind: 'url', url: 'https://blob.test/media' },
      source: 'photo.png',
      ...shown,
    })
  })

  it('falls back to the path line for media when the model takes only inline bytes', () => {
    const content = contentOf({
      attachment: media,
      imageCapabilities: inlineModel,
      mediaUrls: urls,
    })

    expect(content?.[0]).toEqual({
      type: 'text',
      text: operatorSaidAs('look\n[image photo.png · 4×3]'),
    })
  })

  it('falls back to the path line for media when no url could be signed', () => {
    const content = contentOf({ attachment: media, imageCapabilities: urlModel })

    expect(content?.some((part) => part.type === 'image')).toBe(false)
  })

  it('keeps today’s inline behaviour when no capabilities are given', () => {
    expect(contentOf({ attachment: upload })?.[2]).toMatchObject({
      type: 'image',
      bytes: { kind: 'inline', data: 'iVBORw0KGgo=' },
    })
  })
})
