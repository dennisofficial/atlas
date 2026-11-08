import { describe, expect, it } from 'bun:test'

import { EAttachmentStore, resolveMediaUrls, toThreadId, type Attachment } from '@dltech/atlas-core'

import type { UploadDownload } from '../said-uploads'
import { uploadMediaUrls } from '../upload-media-urls'

const threadId = toThreadId('thread-1')
const UPLOAD_ID = '11111111-1111-4111-8111-111111111111'
const PATHNAME = `composer-uploads/user/${UPLOAD_ID}/shot.png`

const ref = { uploadId: UPLOAD_ID, pathname: PATHNAME, name: 'shot.png' }

const picture: Attachment = {
  id: UPLOAD_ID,
  name: 'shot.png',
  mediaType: 'image/png',
  size: 8,
  content: { store: EAttachmentStore.Upload, uploadId: UPLOAD_ID, pathname: PATHNAME },
}

const granting =
  (asked: unknown[]): UploadDownload =>
  async (args) => {
    asked.push(args)
    return { found: true, downloadUrl: `https://blob.test/get/${asked.length}`, size: 8 }
  }

describe('uploadMediaUrls', () => {
  it('answers an upload ref with the download grant the API signs for its thread', async () => {
    const asked: unknown[] = []

    const url = await uploadMediaUrls({ download: granting(asked) }).urlOf({ ref, threadId })

    expect(url).toBe('https://blob.test/get/1')
    expect(asked).toEqual([{ threadId, pathname: PATHNAME }])
  })

  it('reuses a grant while it is fresh and asks again once it has aged', async () => {
    const asked: unknown[] = []
    let now = 0
    const urls = uploadMediaUrls({ download: granting(asked), now: () => now })

    await urls.urlOf({ ref, threadId })
    now = 60_000
    const reused = await urls.urlOf({ ref, threadId })
    now = 11 * 60_000
    const fresh = await urls.urlOf({ ref, threadId })

    expect(reused).toBe('https://blob.test/get/1')
    expect(fresh).toBe('https://blob.test/get/2')
  })

  it('leaves a picture out of the resolved urls when the API no longer stores it', async () => {
    const urls = await resolveMediaUrls({
      attachments: [picture],
      threadId,
      resolver: uploadMediaUrls({ download: async () => ({ found: false }) }),
    })

    expect(urls.size).toBe(0)
  })

  it('leaves a media hash out, since this surface holds no media signer', async () => {
    const asked: unknown[] = []

    await expect(
      uploadMediaUrls({ download: granting(asked) }).urlOf({ ref: { hash: 'h' }, threadId }),
    ).rejects.toThrow()
    expect(asked).toEqual([])
  })
})
