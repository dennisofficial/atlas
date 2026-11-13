import { describe, expect, it } from 'bun:test'

import {
  SIGN_WINDOW_MS,
  attachmentsOf,
  messagesFromEvents,
  resolveMediaUrls,
  toEventId,
  toRunId,
  toThreadId,
  uploadBlobPathnameOf,
  type EventOfType,
  type RuleContext,
} from '@dltech/atlas-core'
import { FakeMediaStore } from '@dltech/atlas-media/testing'

import { SecretCipher } from '../../config/secret-cipher'
import { MediaSigner } from '../media-signer'
import { attachmentUrlBinding, signerAttachmentUrls } from '../media-urls'
import { MemoryMediaSigningWindows } from './support'

const threadId = toThreadId('thread-1')

const UPLOAD_ID = '11111111-1111-4111-8111-111111111111'

const AT = 3 * SIGN_WINDOW_MS + 1000

const setup = (opts: { now?: () => number } = {}) => {
  const store = new FakeMediaStore()
  const signer = new MediaSigner({
    store,
    windows: new MemoryMediaSigningWindows(),
    cipher: new SecretCipher('a'.repeat(64)),
    now: () => AT,
  })
  const urls = signerAttachmentUrls({ signer, userId: 'u1', now: opts.now ?? (() => AT) })
  return { store, urls }
}

const uploadRef = (userId: string) => ({
  uploadId: UPLOAD_ID,
  name: 'a.png',
  pathname: uploadBlobPathnameOf({ userId, uploadId: UPLOAD_ID, name: 'a.png' }),
})

const stored = (store: FakeMediaStore, userId: string) => {
  store.blobs.set(uploadRef(userId).pathname, 4)
}

describe('signerAttachmentUrls', () => {
  it('signs a media hash', async () => {
    const url = await setup().urls.urlOf({ ref: { hash: 'a'.repeat(64) }, threadId })

    expect(url).toContain(`media/u1/${'a'.repeat(64)}`)
  })

  it('signs an upload id the user owns', async () => {
    const { store, urls } = setup()
    stored(store, 'u1')

    const url = await urls.urlOf({ ref: uploadRef('u1'), threadId })

    expect(url).toContain(UPLOAD_ID)
  })

  it('refuses an upload that belongs to someone else', async () => {
    const { store, urls } = setup()
    stored(store, 'u2')

    await expect(urls.urlOf({ ref: uploadRef('u2'), threadId })).rejects.toThrow(/not owned/)
  })

  it('refuses an upload whose blob is gone', async () => {
    await expect(setup().urls.urlOf({ ref: uploadRef('u1'), threadId })).rejects.toThrow(/no blob/)
  })

  it('keeps calling a deleted upload missing without asking the store again', async () => {
    const { store, urls } = setup()
    let heads = 0
    const head = store.head.bind(store)
    store.head = async (args) => {
      heads += 1
      return head(args)
    }

    await expect(urls.urlOf({ ref: uploadRef('u1'), threadId })).rejects.toThrow(/no blob/)
    stored(store, 'u1')

    await expect(urls.urlOf({ ref: uploadRef('u1'), threadId })).rejects.toThrow(/no blob/)
    expect(heads).toBe(1)
  })

  it('holds a present blob for the cached window and checks again past it', async () => {
    let now = AT
    const { store, urls } = setup({ now: () => now })
    stored(store, 'u1')
    let heads = 0
    const head = store.head.bind(store)
    store.head = async (args) => {
      heads += 1
      return head(args)
    }

    await urls.urlOf({ ref: uploadRef('u1'), threadId })
    now = AT + 30_000
    await urls.urlOf({ ref: uploadRef('u1'), threadId })
    expect(heads).toBe(1)

    now = AT + 61_000
    await urls.urlOf({ ref: uploadRef('u1'), threadId })
    expect(heads).toBe(2)
  })
})

const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

const saidEvent = (userId: string): EventOfType<'user-said'> => ({
  id: toEventId('event-1'),
  seq: 1,
  threadId,
  runId: toRunId('run-1'),
  depth: 0,
  at: '2026-11-10T00:00:00.000Z',
  type: 'user-said',
  text: 'what is this?',
  images: [{ path: 'a.png', mediaType: 'image/png', data: PNG, width: 1, height: 1 }],
  uploads: [
    {
      uploadId: UPLOAD_ID,
      pathname: uploadBlobPathnameOf({ userId, uploadId: UPLOAD_ID, name: 'a.png' }),
      name: 'a.png',
      size: 68,
      mediaType: 'image/png',
    },
  ],
})

const picturePartsOf = async (store: FakeMediaStore): Promise<unknown[]> => {
  const event = saidEvent('u1')
  const mediaUrls = await resolveMediaUrls({
    attachments: attachmentsOf(event),
    threadId,
    resolver: signerAttachmentUrls({ signer: signerFor(store), userId: 'u1', now: () => AT }),
  })
  const ctx: RuleContext = {
    events: [event],
    threadId,
    step: 0,
    provider: { id: 'probe', modelId: 'probe-vision' },
    imageCapabilities: { images: 'both', maxInlineBytes: 5_000_000, maxEdge: 8000 },
    mediaUrls,
  }
  const messages = messagesFromEvents()({ system: [], messages: [] }, ctx).messages
  return (messages[0]?.message.content ?? []).filter((part) => part.type === 'image')
}

const signerFor = (store: FakeMediaStore) =>
  new MediaSigner({
    store,
    windows: new MemoryMediaSigningWindows(),
    cipher: new SecretCipher('a'.repeat(64)),
    now: () => AT,
  })

describe('a said picture whose upload blob is gone', () => {
  it('hands the model the bytes the event carries instead of a url', async () => {
    const store = new FakeMediaStore()

    const parts = await picturePartsOf(store)

    expect(parts).toEqual([
      expect.objectContaining({
        type: 'image',
        bytes: { kind: 'inline', data: PNG },
      }),
    ])
  })

  it('hands the model the url while the blob is there', async () => {
    const store = new FakeMediaStore()
    store.blobs.set(uploadRef('u1').pathname, 68)

    const parts = await picturePartsOf(store)

    expect(parts).toEqual([
      expect.objectContaining({ type: 'image', bytes: { kind: 'url', url: expect.any(String) } }),
    ])
  })
})

describe('attachmentUrlBinding', () => {
  it('binds nothing without a signer', () => {
    expect(attachmentUrlBinding({ signer: undefined, userId: 'u1' })).toEqual({})
  })
})
