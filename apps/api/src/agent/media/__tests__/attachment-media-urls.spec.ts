import { describe, expect, it } from 'bun:test'

import {
  EUploadState,
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
  type UploadPlacement,
} from '@dltech/atlas-core'
import { FakeMediaStore } from '@dltech/atlas-media/testing'

import { SecretCipher } from '@dltech/atlas-pods/config/secret-cipher'
import { MediaSigner } from '../media-signer'
import { attachmentUrlBinding, signerAttachmentUrls } from '../media-urls'
import { MemoryMediaSigningWindows } from './support'

const threadId = toThreadId('thread-1')

const UPLOAD_ID = '11111111-1111-4111-8111-111111111111'

const HASH = 'a'.repeat(64)

const AT = 3 * SIGN_WINDOW_MS + 1000

const signerFor = (store: FakeMediaStore) =>
  new MediaSigner({
    store,
    windows: new MemoryMediaSigningWindows(),
    cipher: new SecretCipher('a'.repeat(64)),
    now: () => AT,
  })

const setup = () => {
  const store = new FakeMediaStore()
  const urls = signerAttachmentUrls({ signer: signerFor(store), userId: 'u1' })
  let heads = 0
  const head = store.head.bind(store)
  store.head = async (args) => {
    heads += 1
    return head(args)
  }
  return { store, urls, heads: () => heads }
}

const uploadRef = (userId: string) => ({
  uploadId: UPLOAD_ID,
  name: 'a.png',
  pathname: uploadBlobPathnameOf({ userId, uploadId: UPLOAD_ID, name: 'a.png' }),
})

const placementsOf = (args: {
  fileId: string
  placement: UploadPlacement
}): ReadonlyMap<string, UploadPlacement> => new Map([[args.fileId, args.placement]])

describe('signerAttachmentUrls', () => {
  it('signs a media hash without asking the store', async () => {
    const { urls, heads } = setup()

    const url = await urls.urlOf({ ref: { hash: HASH }, threadId })

    expect(url).toContain(`media/u1/${HASH}`)
    expect(heads()).toBe(0)
  })

  it('signs an upload id the user owns without asking the store', async () => {
    const { urls, heads } = setup()

    const url = await urls.urlOf({ ref: uploadRef('u1'), threadId })

    expect(url).toContain(UPLOAD_ID)
    expect(heads()).toBe(0)
  })

  it('refuses an upload that belongs to someone else', async () => {
    const { urls } = setup()

    await expect(urls.urlOf({ ref: uploadRef('u2'), threadId })).rejects.toThrow(/not owned/)
  })

  it('refuses a file whose placement fact says it is missing', async () => {
    const { urls, heads } = setup()
    const placements = placementsOf({
      fileId: UPLOAD_ID,
      placement: { state: EUploadState.Missing },
    })

    await expect(urls.urlOf({ ref: uploadRef('u1'), threadId, placements })).rejects.toThrow(
      /no longer available/,
    )
    expect(heads()).toBe(0)
  })

  it('refuses a stored picture whose placement fact says it is missing', async () => {
    const { urls } = setup()
    const placements = placementsOf({ fileId: HASH, placement: { state: EUploadState.Missing } })

    await expect(urls.urlOf({ ref: { hash: HASH }, threadId, placements })).rejects.toThrow(
      /no longer available/,
    )
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

const picturePartsOf = async (args: {
  store: FakeMediaStore
  placements?: ReadonlyMap<string, UploadPlacement> | undefined
}): Promise<unknown[]> => {
  const event = saidEvent('u1')
  const mediaUrls = await resolveMediaUrls({
    attachments: attachmentsOf(event),
    threadId,
    resolver: signerAttachmentUrls({ signer: signerFor(args.store), userId: 'u1' }),
    ...(args.placements === undefined ? {} : { placements: args.placements }),
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

describe('a said picture with no placement fact', () => {
  it('hands the model a signed url without checking the blob', async () => {
    const parts = await picturePartsOf({ store: new FakeMediaStore() })

    expect(parts).toEqual([
      expect.objectContaining({ type: 'image', bytes: { kind: 'url', url: expect.any(String) } }),
    ])
  })
})

describe('a said picture whose placement fact says it is missing', () => {
  it('hands the model the bytes the event carries instead of a url', async () => {
    const placements = placementsOf({
      fileId: UPLOAD_ID,
      placement: { state: EUploadState.Missing },
    })

    const parts = await picturePartsOf({ store: new FakeMediaStore(), placements })

    expect(parts).toEqual([
      expect.objectContaining({
        type: 'image',
        bytes: { kind: 'inline', data: PNG },
      }),
    ])
  })
})

describe('attachmentUrlBinding', () => {
  it('binds nothing without a signer', () => {
    expect(attachmentUrlBinding({ signer: undefined, userId: 'u1' })).toEqual({})
  })
})
