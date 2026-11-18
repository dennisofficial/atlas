import { describe, expect, it } from 'bun:test'

import { SIGN_WINDOW_MS, type MediaRef, type Message } from '@dltech/atlas-core'
import { FakeMediaStore } from '@dltech/atlas-media/testing'

import { SecretCipher } from '../../config/secret-cipher'
import { MediaSigner } from '../media-signer'
import { mediaHashesOf, signerUrls } from '../media-urls'
import { MemoryMediaSigningWindows } from './support'

const refOf = (letter: string): MediaRef => ({
  hash: letter.repeat(64),
  mediaType: 'image/png',
  size: 10,
  width: 4,
  height: 4,
})

const messages: Message[] = [
  {
    role: 'user',
    content: [
      { type: 'text', text: 'look' },
      { type: 'media', media: refOf('a') },
      { type: 'media', media: refOf('b') },
    ],
  },
  { role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
  {
    role: 'tool',
    content: [
      {
        type: 'tool-result',
        toolCallId: 'c1',
        toolName: 'read',
        output: {
          type: 'content',
          value: [{ type: 'media', media: refOf('b') }],
        },
      },
      {
        type: 'tool-result',
        toolCallId: 'c2',
        toolName: 'read',
        output: {
          type: 'content',
          value: [{ type: 'media', media: refOf('c') }],
        },
      },
      {
        type: 'tool-result',
        toolCallId: 'c3',
        toolName: 'read',
        output: { type: 'json', value: {} },
      },
    ],
  },
]

const setup = () => {
  const store = new FakeMediaStore()
  const windows = new MemoryMediaSigningWindows()
  const signer = new MediaSigner({
    store,
    windows,
    cipher: new SecretCipher('a'.repeat(64)),
    now: () => 3 * SIGN_WINDOW_MS + 1000,
  })
  return { store, signer, urls: signerUrls({ signer, userId: 'u1' }) }
}

describe('mediaHashesOf', () => {
  it('lists each hash once across user and tool-result content', () => {
    expect(mediaHashesOf(messages)).toEqual(['a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64)])
  })

  it('finds nothing in a prompt without media', () => {
    expect(mediaHashesOf([{ role: 'user', content: [{ type: 'text', text: 'hi' }] }])).toEqual([])
  })
})

describe('signerUrls', () => {
  it('never calls ready for an empty prompt', async () => {
    const { store, urls } = setup()
    expect((await urls.urlsFor([])).size).toBe(0)
    expect(store.issued).toBe(0)
  })

  it('returns identical urls from two calls in one window', async () => {
    const { store, urls } = setup()
    const hashes = mediaHashesOf(messages)
    const first = await urls.urlsFor(hashes)
    const second = await urls.urlsFor(hashes)
    expect([...second]).toEqual([...first])
    expect(first.size).toBe(3)
    expect(first.get('a'.repeat(64))).toContain(`u1/`)
    expect(store.issued).toBe(1)
  })
})

describe('signerUrls missingOf', () => {
  it('names only the hashes whose blob is gone', async () => {
    const { store, urls } = setup()
    store.blobs.set(`media/u1/${'a'.repeat(64)}`, 10)
    expect(await urls.missingOf(['a'.repeat(64), 'b'.repeat(64)])).toEqual(['b'.repeat(64)])
  })
})
