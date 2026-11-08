import { describe, expect, it } from 'bun:test'

import { SIGN_WINDOW_MS, toThreadId, uploadBlobPathnameOf } from '@dltech/atlas-core'
import { FakeMediaStore } from '@dltech/atlas-media/testing'

import { SecretCipher } from '../../config/secret-cipher'
import { MediaSigner } from '../media-signer'
import { attachmentUrlBinding, signerAttachmentUrls } from '../media-urls'
import { MemoryMediaSigningWindows } from './support'

const threadId = toThreadId('thread-1')

const UPLOAD_ID = '11111111-1111-4111-8111-111111111111'

const setup = () => {
  const signer = new MediaSigner({
    store: new FakeMediaStore(),
    windows: new MemoryMediaSigningWindows(),
    cipher: new SecretCipher('a'.repeat(64)),
    now: () => 3 * SIGN_WINDOW_MS + 1000,
  })
  return signerAttachmentUrls({ signer, userId: 'u1' })
}

const uploadRef = (userId: string) => ({
  uploadId: UPLOAD_ID,
  name: 'a.png',
  pathname: uploadBlobPathnameOf({ userId, uploadId: UPLOAD_ID, name: 'a.png' }),
})

describe('signerAttachmentUrls', () => {
  it('signs a media hash', async () => {
    const url = await setup().urlOf({ ref: { hash: 'a'.repeat(64) }, threadId })

    expect(url).toContain(`media/u1/${'a'.repeat(64)}`)
  })

  it('signs an upload id the user owns', async () => {
    const url = await setup().urlOf({ ref: uploadRef('u1'), threadId })

    expect(url).toContain(UPLOAD_ID)
  })

  it('refuses an upload that belongs to someone else', async () => {
    await expect(setup().urlOf({ ref: uploadRef('u2'), threadId })).rejects.toThrow(/not owned/)
  })
})

describe('attachmentUrlBinding', () => {
  it('binds nothing without a signer', () => {
    expect(attachmentUrlBinding({ signer: undefined, userId: 'u1' })).toEqual({})
  })
})
