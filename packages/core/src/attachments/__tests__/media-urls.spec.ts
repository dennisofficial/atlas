import { describe, expect, it } from 'bun:test'

import { EAttachmentStore, type Attachment } from '../attachment'
import { mediaUrlKeyOf, resolveMediaUrls } from '../media-urls'

const picture = (content: Attachment['content'], id = 'a'): Attachment => ({
  id,
  name: 'a.png',
  mediaType: 'image/png',
  size: 1,
  content,
})

describe('resolveMediaUrls', () => {
  it('resolves a media hash and an upload id once each, and skips inline and non-image attachments', async () => {
    const asked: string[] = []
    const resolver = {
      async urlOf(ref: Parameters<typeof mediaUrlKeyOf>[0]) {
        asked.push(mediaUrlKeyOf(ref))
        return `https://x.test/${mediaUrlKeyOf(ref)}`
      },
    }
    const media = picture({ store: EAttachmentStore.Media, hash: 'h' })
    const upload = picture({ store: EAttachmentStore.Upload, uploadId: 'u', pathname: 'p' }, 'u')
    const document: Attachment = {
      ...picture({ store: EAttachmentStore.Media, hash: 'z' }),
      mediaType: 'application/pdf',
    }

    const urls = await resolveMediaUrls({
      attachments: [
        media,
        media,
        upload,
        document,
        picture({ store: EAttachmentStore.Inline, data: 'AA' }),
      ],
      resolver,
    })

    expect(asked).toEqual(['media:h', 'upload:u'])
    expect(urls.get('media:h')).toBe('https://x.test/media:h')
    expect(urls.size).toBe(2)
  })

  it('leaves out an attachment whose url could not be made', async () => {
    const urls = await resolveMediaUrls({
      attachments: [picture({ store: EAttachmentStore.Media, hash: 'h' })],
      resolver: {
        async urlOf() {
          throw new Error('no signer')
        },
      },
    })

    expect(urls.size).toBe(0)
  })
})
