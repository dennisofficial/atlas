import { describe, expect, it } from 'bun:test'

import { mediaPathname, type MediaRef } from '@dltech/atlas-core'
import { sha256Hex } from '@dltech/atlas-media'
import { FakeMediaStore } from '@dltech/atlas-media/testing'

import { pictureStoreOf, type PictureRegistry } from '../picture-store'

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)
const HASH = sha256Hex(new Uint8Array(PNG))
const USER = 'user-1'
const SIGNAL = new AbortController().signal

const registryOf = (): {
  rows: Map<string, MediaRef>
  inserted: MediaRef[]
  registry: PictureRegistry
} => {
  const rows = new Map<string, MediaRef>()
  const inserted: MediaRef[] = []
  return {
    rows,
    inserted,
    registry: {
      find: async (args) => rows.get(`${args.userId}/${args.hash}`),
      insertIfAbsent: async (args) => {
        rows.set(`${args.userId}/${args.media.hash}`, args.media)
        inserted.push(args.media)
      },
    },
  }
}

describe('pictureStoreOf', () => {
  it('writes a new picture to the store and registers it', async () => {
    const store = new FakeMediaStore()
    const { rows, inserted, registry } = registryOf()
    const pictures = pictureStoreOf({ store, registry, userId: USER })

    const media = await pictures.store({
      bytes: new Uint8Array(PNG),
      mediaType: 'image/png',
      signal: SIGNAL,
    })

    expect(media).toEqual({
      hash: HASH,
      mediaType: 'image/png',
      size: PNG.byteLength,
      width: 1,
      height: 1,
    })
    expect(store.blobs.has(mediaPathname({ userId: USER, hash: HASH }))).toBe(true)
    expect(inserted).toEqual([media as MediaRef])
    expect(rows.size).toBe(1)
  })

  it('returns the registered ref without writing a picture it already holds', async () => {
    const store = new FakeMediaStore()
    const { registry } = registryOf()
    const pictures = pictureStoreOf({ store, registry, userId: USER })
    const first = await pictures.store({
      bytes: new Uint8Array(PNG),
      mediaType: 'image/png',
      signal: SIGNAL,
    })
    const puts = store.blobs.size

    const second = await pictures.store({
      bytes: new Uint8Array(PNG),
      mediaType: 'image/png',
      signal: SIGNAL,
    })

    expect(second).toEqual(first)
    expect(store.blobs.size).toBe(puts)
  })

  it('refuses bytes that are not a supported picture', async () => {
    const store = new FakeMediaStore()
    const { rows, registry } = registryOf()
    const pictures = pictureStoreOf({ store, registry, userId: USER })

    const media = await pictures.store({
      bytes: new Uint8Array(Buffer.from('not a picture')),
      mediaType: 'image/png',
      signal: SIGNAL,
    })

    expect(media).toBeNull()
    expect(store.blobs.size).toBe(0)
    expect(rows.size).toBe(0)
  })

  it('keeps the picture of one user out of another user path', async () => {
    const store = new FakeMediaStore()
    const { registry } = registryOf()
    const pictures = pictureStoreOf({ store, registry, userId: 'user-2' })

    await pictures.store({ bytes: new Uint8Array(PNG), mediaType: 'image/png', signal: SIGNAL })

    expect(store.blobs.has(mediaPathname({ userId: 'user-2', hash: HASH }))).toBe(true)
    expect(store.blobs.has(mediaPathname({ userId: USER, hash: HASH }))).toBe(false)
  })

  it('hands the caller signal to the upload it started', async () => {
    class SignallingStore extends FakeMediaStore {
      readonly signals: (AbortSignal | undefined)[] = []

      override async put(args: {
        pathname: string
        bytes: Uint8Array
        mediaType?: string | undefined
        signal?: AbortSignal | undefined
      }): Promise<void> {
        this.signals.push(args.signal)
        return super.put(args)
      }
    }
    const store = new SignallingStore()
    const { registry } = registryOf()
    const pictures = pictureStoreOf({ store, registry, userId: USER })

    await pictures.store({ bytes: new Uint8Array(PNG), mediaType: 'image/png', signal: SIGNAL })

    expect(store.signals).toEqual([SIGNAL])
  })
})
